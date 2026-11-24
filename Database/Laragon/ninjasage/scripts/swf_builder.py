#!/usr/bin/env python3
"""
Dynamic SWF Stage Compiler for Ninja Saga Mobile (Ruffle WASM).
Implements Ninja Horizon's Single-Ruffle-Instance 36 FPS Battle Engine:
  - `build-battle`: Compiles ONE unified 36 FPS Battle SWF containing:
      * Dressed Player variants (standby, attack_01, charge, hit, win, dead) at Left (X=155, Y=280, sx=-0.52)
      * Enemy variants (standby, attack_01, hit, dead) at Right (X=615, Y=280, sx=+0.52)
      * All equipped Player Jutsu skills (dressed with player gear!) at Left->Right (X=155 -> X=615)
      * Root timeline choreography controlled in real-time via AVM1 ExternalInterface (`__pollCmd`, `__onHit`, `__onDone`)
        so Ruffle loads ONCE at battle start and switches animations in <1 frame (0ms reload lag!).
"""

import os
import sys
import json
import math
import struct
import zlib
import lzma

DEFINITION_TAGS = {2, 6, 11, 14, 20, 21, 22, 32, 33, 34, 35, 36, 37, 39, 46, 48, 75, 83, 84}

ARENA_W = 860
ARENA_H = 440
PLAYER_TX = 220.0
PLAYER_TY = 255.0
ENEMY_TX = 630.0
ENEMY_TY = 255.0
PLAYER_MELEE_TX = 572.0  # Right in front of Enemy (630) so 0.25-scale melee slashes connect
ENEMY_MELEE_TX = 288.0   # Right in front of Player (220), pulled back 10px so slashes connect cleanly
CHAR_SCALE = 0.25
FPS_36_FIXED = 36 * 256  # 36.0 FPS like Ninja Horizon's fps36
FPS_60_FIXED = 60 * 256  # 60.0 FPS battle testing mode

PLAYER_PART_SLOTS = {
    "back": (508, 1),
    "back_item": (508, 1),
    "right_upper_arm": (509, 3),
    "right_shoe": (510, 2),
    "right_upper_leg": (511, 2),
    "right_lower_leg": (512, 4),
    "left_upper_leg": (513, 2),
    "left_shoe": (514, 2),
    "left_lower_leg": (515, 4),
    "lower_body": (516, 2),
    "skirt": (517, 1),
    "right_lower_arm": (518, 3),
    "right_hand": (519, 3),
    "upper_body": (520, 4),
    "face": (521, 2),
    "hair": (521, 4),
    "left_upper_arm": (522, 3),
    "weapon": (524, 1),
    "left_lower_arm": (525, 3),
    "left_hand": (526, 3),
}


def decompress_swf(path: str) -> bytes:
    with open(path, "rb") as f:
        raw = f.read()
    sig = raw[:3]
    if sig == b"FWS":
        return raw
    if sig == b"CWS":
        return b"FWS" + raw[3:8] + zlib.decompress(raw[8:])
    if sig == b"ZWS":
        header = raw[12:17] + struct.pack("<q", -1)
        dec = lzma.LZMADecompressor(lzma.FORMAT_ALONE).decompress(header + raw[17:])
        return b"FWS" + raw[3:8] + dec
    raise ValueError(f"Unsupported SWF signature in {path}: {sig!r}")


def parse_header(data: bytes):
    version = data[3]
    nbits = data[8] >> 3
    rect_bytes = (5 + nbits * 4 + 7) // 8
    pos = 8 + rect_bytes
    fps_fixed, frame_count = struct.unpack("<HH", data[pos : pos + 4])
    return version, fps_fixed, frame_count, pos + 4


def parse_tags(buf: bytes, pos: int = 0):
    out = []
    n = len(buf)
    while pos + 2 <= n:
        hdr = struct.unpack("<H", buf[pos : pos + 2])[0]
        pos += 2
        code = hdr >> 6
        length = hdr & 0x3F
        if length == 0x3F:
            length = struct.unpack("<I", buf[pos : pos + 4])[0]
            pos += 4
        body = buf[pos : pos + length]
        pos += length
        out.append((code, body))
        if code == 0:
            break
    return out


def encode_tag(code: int, body: bytes) -> bytes:
    length = len(body)
    if length < 0x3F:
        return struct.pack("<H", (code << 6) | length) + body
    return struct.pack("<HI", (code << 6) | 0x3F, length) + body


def pack_bits(bit_pairs) -> bytes:
    acc = 0
    total_bits = 0
    for val, nbits in bit_pairs:
        if nbits <= 0:
            continue
        mask = (1 << nbits) - 1
        acc = (acc << nbits) | (val & mask)
        total_bits += nbits
    rem = (8 - (total_bits % 8)) % 8
    if rem:
        acc <<= rem
        total_bits += rem
    return acc.to_bytes(total_bits // 8, "big")


def sbits_len(vals) -> int:
    mx = 1
    for v in vals:
        if v == 0:
            nb = 1
        elif v > 0:
            nb = v.bit_length() + 1
        else:
            nb = (-v - 1).bit_length() + 1
        if nb > mx:
            mx = nb
    return mx


def encode_rect(xmin_px: float, xmax_px: float, ymin_px: float, ymax_px: float) -> bytes:
    vals = [
        int(round(xmin_px * 20)),
        int(round(xmax_px * 20)),
        int(round(ymin_px * 20)),
        int(round(ymax_px * 20)),
    ]
    nb = sbits_len(vals)
    return pack_bits([(nb, 5), (vals[0], nb), (vals[1], nb), (vals[2], nb), (vals[3], nb)])


def encode_matrix(tx_px: float, ty_px: float, sx: float = 1.0, sy: float = 1.0) -> bytes:
    pairs = []
    if abs(sx - 1.0) > 1e-4 or abs(sy - 1.0) > 1e-4:
        s_vals = [int(round(sx * 65536)), int(round(sy * 65536))]
        s_nb = sbits_len(s_vals)
        pairs.extend([(1, 1), (s_nb, 5), (s_vals[0], s_nb), (s_vals[1], s_nb)])
    else:
        pairs.append((0, 1))
    pairs.append((0, 1))  # HasRotate = 0
    t_vals = [int(round(tx_px * 20)), int(round(ty_px * 20))]
    t_nb = sbits_len(t_vals)
    pairs.extend([(t_nb, 5), (t_vals[0], t_nb), (t_vals[1], t_nb)])
    return pack_bits(pairs)


def encode_place_object2(
    depth: int,
    cid: int,
    tx_px: float,
    ty_px: float,
    sx: float = 1.0,
    sy: float = 1.0,
    move: bool = False,
    name: str = "",
) -> bytes:
    flags = 0x06 | (0x01 if move else 0x00) | (0x20 if name else 0x00)
    body = struct.pack("<BHH", flags, depth, cid) + encode_matrix(tx_px, ty_px, sx, sy)
    if name:
        body += name.encode("utf-8") + b"\x00"
    return encode_tag(26, body)


def encode_move_object2(
    depth: int,
    tx_px: float,
    ty_px: float,
    sx: float = 1.0,
    sy: float = 1.0,
) -> bytes:
    """Moves an existing instance at `depth` without replacing or resetting its animation."""
    flags = 0x05  # HasMatrix (0x04) | Move (0x01), HasCharacter = 0
    body = struct.pack("<BH", flags, depth) + encode_matrix(tx_px, ty_px, sx, sy)
    return encode_tag(26, body)


def build_swf(version: int, rect_bytes: bytes, fps_fixed: int, frame_count: int, tags_bytes: bytes) -> bytes:
    body = rect_bytes + struct.pack("<HH", fps_fixed, frame_count) + tags_bytes
    uncomp_len = 8 + len(body)
    return b"CWS" + struct.pack("<BI", max(9, min(version, 19)), uncomp_len) + zlib.compress(body)


def skip_matrix(buf: bytes, pos: int) -> int:
    bitpos = pos * 8

    def rbits(n):
        nonlocal bitpos
        val = 0
        for _ in range(n):
            val = (val << 1) | ((buf[bitpos >> 3] >> (7 - (bitpos & 7))) & 1)
            bitpos += 1
        return val

    if rbits(1):
        nb = rbits(5)
        rbits(nb * 2)
    if rbits(1):
        nb = rbits(5)
        rbits(nb * 2)
    nb = rbits(5)
    rbits(nb * 2)
    return (bitpos + 7) >> 3


def skip_cxform(buf: bytes, pos: int) -> int:
    bitpos = pos * 8

    def rbits(n):
        nonlocal bitpos
        val = 0
        for _ in range(n):
            val = (val << 1) | ((buf[bitpos >> 3] >> (7 - (bitpos & 7))) & 1)
            bitpos += 1
        return val

    has_add = rbits(1)
    has_mult = rbits(1)
    nb = rbits(4)
    if has_mult:
        rbits(nb * 4)
    if has_add:
        rbits(nb * 4)
    return (bitpos + 7) >> 3


def parse_place2_info(body: bytes):
    flags = body[0]
    depth = struct.unpack("<H", body[1:3])[0]
    p = 3
    cid = None
    if flags & 0x02:
        cid = struct.unpack("<H", body[p : p + 2])[0]
        p += 2
    if flags & 0x04:
        p = skip_matrix(body, p)
    if flags & 0x08:
        p = skip_cxform(body, p)
    if flags & 0x10:
        p += 2
    name = None
    if flags & 0x20:
        end = body.find(b"\x00", p)
        if end != -1:
            name = body[p:end].decode("utf-8", "replace")
    return flags, depth, cid, name


def parse_place3_info(body: bytes):
    fl1, fl2, depth = struct.unpack("<BBH", body[:4])
    p = 4
    if fl2 & 0x08:
        end = body.find(b"\x00", p)
        p = (end + 1) if end != -1 else len(body)
    cid_offset = None
    cid = None
    if fl1 & 0x02:
        cid_offset = p
        cid = struct.unpack("<H", body[p : p + 2])[0]
        p += 2
    if fl1 & 0x04:
        p = skip_matrix(body, p)
    if fl1 & 0x08:
        p = skip_cxform(body, p)
    if fl1 & 0x10:
        p += 2
    name = None
    if fl1 & 0x20:
        end = body.find(b"\x00", p)
        if end != -1:
            name = body[p:end].decode("utf-8", "replace")
    return fl1, fl2, depth, cid, name, cid_offset


def optimize_place3_for_mobile_gpu(body: bytes) -> bytes:
    """
    Strips GPU-heavy offscreen FBO SurfaceFilterList (Blur/Glow/DropShadow/Bevel/etc., fl2 & 0x01)
    and animated CacheAsBitmap (fl2 & 0x04) from PlaceObject3 tags while preserving BlendMode (Add/Screen),
    ColorTransform, Matrix, ClipDepth, Visible, and ClipActions intact.
    Eliminates multi-pass FBO shader stalls in Ruffle WebGL on mobile across all 1,160+ jutsu SWFs!
    """
    if len(body) < 4:
        return body
    fl1, fl2 = body[0], body[1]
    if (fl2 & 0x05) == 0:
        return body
    try:
        n = len(body)
        p = 4
        if fl2 & 0x08:
            end = body.find(b"\x00", p)
            if end == -1:
                return body
            p = end + 1
        if fl1 & 0x02:
            p += 2
        if fl1 & 0x04:
            p = skip_matrix(body, p)
        if fl1 & 0x08:
            p = skip_cxform(body, p)
        if fl1 & 0x10:
            p += 2
        if fl1 & 0x20:
            end = body.find(b"\x00", p)
            if end == -1:
                return body
            p = end + 1
        if fl1 & 0x40:
            p += 2
        if p > n:
            return body

        out = bytearray(body[:p])
        out[1] = fl2 & ~0x05  # clear HasFilterList (0x01) & HasCacheAsBitmap (0x04)

        # Skip SurfaceFilterList if present
        if fl2 & 0x01:
            if p >= n:
                return body
            num_filters = body[p]
            p += 1
            for _ in range(num_filters):
                if p >= n:
                    return body
                fid = body[p]
                p += 1
                if fid == 0:      # DropShadowFilter
                    p += 23
                elif fid == 1:    # BlurFilter
                    p += 9
                elif fid == 2:    # GlowFilter
                    p += 15
                elif fid == 3:    # BevelFilter
                    p += 27
                elif fid in (4, 7):  # GradientGlowFilter / GradientBevelFilter
                    if p >= n:
                        return body
                    num_colors = body[p]
                    p += 1 + num_colors * 5 + 19
                elif fid == 5:    # ConvolutionFilter
                    if p + 2 > n:
                        return body
                    mx, my = body[p], body[p + 1]
                    p += 2 + 4 + 4 + mx * my * 4 + 4 + 1
                elif fid == 6:    # ColorMatrixFilter
                    p += 80
                else:
                    return body
                if p > n:
                    return body

        # Preserve BlendMode (1 byte) so Add/Screen elemental glows stay vibrant at 0 FBO cost!
        if fl2 & 0x02:
            if p >= n:
                return body
            out.append(body[p])
            p += 1

        # Skip BitmapCache (1 byte) if present
        if fl2 & 0x04:
            if p >= n:
                return body
            p += 1

        # Preserve remaining fields (Visible, BackgroundColor, ClipActions)
        if p <= n:
            out.extend(body[p:])
        return bytes(out)
    except Exception:
        return body


def avm1_goto_and_play(frame_1_indexed: int) -> bytes:
    f0 = max(0, frame_1_indexed - 1)
    return b"\x81\x02\x00" + struct.pack("<H", f0) + b"\x06\x00"


def avm1_stop() -> bytes:
    return b"\x07\x00"


def avm1_set_target_raw(target: str) -> bytes:
    tb = target.encode("utf-8") + b"\x00"
    return b"\x8B" + struct.pack("<H", len(tb)) + tb


def avm1_clip_goto_stop_raw(target_name: str, frame_1_indexed: int) -> bytes:
    """Returns raw AVM1 opcodes (no trailing 0x00) to tellTarget(target_name).gotoAndStop(frame)."""
    f0 = max(0, frame_1_indexed - 1)
    return (
        avm1_set_target_raw(target_name)
        + b"\x81\x02\x00" + struct.pack("<H", f0)
        + avm1_set_target_raw("")
    )


def avm1_clip_goto_play_raw(target_name: str, frame_1_indexed: int) -> bytes:
    """Returns raw AVM1 opcodes (no trailing 0x00) to tellTarget(target_name).gotoAndPlay(frame)."""
    f0 = max(0, frame_1_indexed - 1)
    return (
        avm1_set_target_raw(target_name)
        + b"\x81\x02\x00" + struct.pack("<H", f0)
        + b"\x06"  # ActionPlay
        + avm1_set_target_raw("")
    )


def avm1_clip_set_pos_raw(target_name: str, x_px: float, y_px: float) -> bytes:
    """Returns raw AVM1 opcodes (no trailing 0x00) to set target._x and target._y via ActionSetProperty."""
    xi = int(round(x_px))
    yi = int(round(y_px))
    return (
        avm1_push_items([("str", target_name), ("int", 0), ("int", xi)]) + b"\x23"
        + avm1_push_items([("str", target_name), ("int", 1), ("int", yi)]) + b"\x23"
    )


def build_enemy_slot_wrapper(wrapper_sid: int, standby_cid: int, atk_cid: int, hit_cid: int, dead_cid: int) -> bytes:
    """
    9-frame MovieClip wrapper for an enemy/ally slot with forward-stepped state transitions
    so Ruffle AVM1 ALWAYS executes Frame 1 DoAction on hit, standby, and dead sprites:
      Frame 1 = standby (initial boot, stop)
      Frame 2 = attack (stop)
      Frame 3 = reset_hit (empty -> advances forward to Frame 4)
      Frame 4 = hit (stop)
      Frame 5 = hidden (empty, stop)
      Frame 6 = reset_standby (empty -> advances forward to Frame 7)
      Frame 7 = fresh standby (stop)
      Frame 8 = reset_dead (empty -> advances forward to Frame 9)
      Frame 9 = fresh dead (stop)
    """
    chunks = []
    # Frame 1: standby
    chunks.append(encode_tag(28, struct.pack("<H", 1)))
    chunks.append(encode_place_object2(1, standby_cid, 0.0, 0.0, 1.0, 1.0, move=False))
    chunks.append(encode_tag(12, avm1_stop()))
    chunks.append(encode_tag(1, b""))
    # Frame 2: attack
    chunks.append(encode_tag(28, struct.pack("<H", 1)))
    chunks.append(encode_place_object2(1, atk_cid, 0.0, 0.0, 1.0, 1.0, move=False))
    chunks.append(encode_tag(12, avm1_stop()))
    chunks.append(encode_tag(1, b""))
    # Frame 3 -> Frame 4: forward-stepped hit
    chunks.append(encode_tag(28, struct.pack("<H", 1)))
    chunks.append(encode_tag(1, b""))
    chunks.append(encode_place_object2(1, hit_cid, 0.0, 0.0, 1.0, 1.0, move=False))
    chunks.append(encode_tag(12, avm1_stop()))
    chunks.append(encode_tag(1, b""))
    # Frame 5: hidden (empty, stopped)
    chunks.append(encode_tag(28, struct.pack("<H", 1)))
    chunks.append(encode_tag(12, avm1_stop()))
    chunks.append(encode_tag(1, b""))
    # Frame 6 -> Frame 7: forward-stepped standby
    chunks.append(encode_tag(28, struct.pack("<H", 1)))
    chunks.append(encode_tag(1, b""))
    chunks.append(encode_place_object2(1, standby_cid, 0.0, 0.0, 1.0, 1.0, move=False))
    chunks.append(encode_tag(12, avm1_stop()))
    chunks.append(encode_tag(1, b""))
    # Frame 8 -> Frame 9: forward-stepped dead
    chunks.append(encode_tag(28, struct.pack("<H", 1)))
    chunks.append(encode_tag(1, b""))
    chunks.append(encode_place_object2(1, dead_cid, 0.0, 0.0, 1.0, 1.0, move=False))
    chunks.append(encode_tag(12, avm1_stop()))
    chunks.append(encode_tag(1, b""))
    chunks.append(encode_tag(0, b""))
    return struct.pack("<HH", wrapper_sid, 9) + b"".join(chunks)


def avm1_push_items(items) -> bytes:
    """
    items: list of ('str', s) or ('int', n)
    """
    payload = bytearray()
    for kind, val in items:
        if kind == "str":
            payload.append(0x00)
            payload.extend(val.encode("utf-8") + b"\x00")
        elif kind == "int":
            payload.append(0x07)
            payload.extend(struct.pack("<i", val))
    return b"\x96" + struct.pack("<H", len(payload)) + bytes(payload)


def avm1_ext_call_expr(js_fn_name: str) -> bytes:
    """
    Calls flash.external.ExternalInterface.call(js_fn_name) and leaves the return value on top of stack.
    """
    bc = bytearray()
    bc.extend(avm1_push_items([("str", js_fn_name), ("int", 1), ("str", "flash")]))
    bc.append(0x1C)  # GetVariable ("flash")
    bc.extend(avm1_push_items([("str", "external")]))
    bc.append(0x4E)  # GetMember
    bc.extend(avm1_push_items([("str", "ExternalInterface")]))
    bc.append(0x4E)  # GetMember
    bc.extend(avm1_push_items([("str", "call")]))
    bc.append(0x52)  # CallMethod -> pushes return value
    return bytes(bc)


def avm1_notify_js(js_fn_name: str, extra_actions: bytes = b"") -> bytes:
    """
    Calls flash.external.ExternalInterface.call(js_fn_name), pops result, and runs extra_actions.
    Always terminates with ActionEnd (0x00).
    """
    tail = extra_actions if extra_actions.endswith(b"\x00") else (extra_actions + b"\x00")
    return avm1_ext_call_expr(js_fn_name) + b"\x17" + tail


def avm1_poll_and_dispatch(cmd_to_frame: dict, loop_target_frame: int = 0) -> bytes:
    """
    Calls window.__pollCmd() via ExternalInterface.call("__pollCmd") and jumps to the target frame
    if a sequence name matches. If loop_target_frame > 0, jumps to that 1-indexed frame on no match.
    """
    bc = bytearray()
    bc.extend(avm1_ext_call_expr("__pollCmd"))
    for seq_name, target_f in cmd_to_frame.items():
        bc.append(0x4C)  # PushDuplicate
        bc.extend(avm1_push_items([("str", seq_name)]))
        bc.append(0x49)  # Equals2
        bc.append(0x12)  # Not
        # Branch body is 8 bytes: Pop (1) + GotoFrame (5) + Play (1) + End (1)
        bc.extend(b"\x9D\x02\x00" + struct.pack("<h", 8))
        bc.append(0x17)  # Pop
        bc.extend(b"\x81\x02\x00" + struct.pack("<H", max(0, target_f - 1)))
        bc.append(0x06)  # Play
        bc.append(0x00)  # End
    bc.append(0x17)  # Pop unmatched cmd
    if loop_target_frame > 0:
        bc.extend(avm1_goto_and_play(loop_target_frame))
    else:
        bc.append(0x00)
    return bytes(bc)


def parse_sprite_segments(sprite_body: bytes):
    sp_id, sp_fc = struct.unpack("<HH", sprite_body[:4])
    sub_tags = parse_tags(sprite_body, 4)
    labels = []
    cur_f = 1
    for sc, sb in sub_tags:
        if sc == 43:
            lbl = sb.split(b"\x00")[0].decode("utf-8", "replace").strip()
            labels.append((cur_f, lbl))
        elif sc == 1:
            cur_f += 1
    segments = {}
    for idx, (f_start, lbl) in enumerate(labels):
        f_end = (labels[idx + 1][0] - 1) if (idx + 1 < len(labels)) else sp_fc
        segments[lbl] = (f_start, max(f_start, f_end))
    return sp_id, sp_fc, sub_tags, segments


def build_variant_sprite(
    sprite_body: bytes,
    new_sid: int,
    anim: str,
    loop_self: bool = False,
    max_frame_cutoff: int = 0,
    strip_cids: set = None,
):
    _, sp_fc, sub_tags, segments = parse_sprite_segments(sprite_body)
    sb_start, sb_end = segments.get("standby", (1, sp_fc))
    target_lbl = anim
    if target_lbl not in segments:
        for k in segments:
            if k.startswith(target_lbl.split("_")[0]):
                target_lbl = k
                break
    t_start, t_end = segments.get(target_lbl, (sb_start, sb_end))

    cutoff = min(sp_fc, max(t_end, max_frame_cutoff) if max_frame_cutoff > 0 else t_end)
    frame_actions = {}
    if t_start > 1:
        frame_actions[1] = avm1_goto_and_play(t_start)
    if loop_self:
        frame_actions[t_end] = avm1_goto_and_play(t_start)
    else:
        frame_actions[t_end] = avm1_stop()

    out_chunks = []
    cur_f = 1
    for sc, sb in sub_tags:
        if sc in (0, 12, 14, 15, 18, 19, 45):
            continue
        if strip_cids and sc == 26:
            _, _, r_cid, _ = parse_place2_info(sb)
            if r_cid in strip_cids:
                continue
        elif strip_cids and sc == 70:
            _, _, _, r_cid, _, _ = parse_place3_info(sb)
            if r_cid in strip_cids:
                continue
        if sc == 1:
            if cur_f in frame_actions:
                out_chunks.append(encode_tag(12, frame_actions[cur_f]))
            out_chunks.append(encode_tag(1, b""))
            if cur_f >= cutoff:
                break
            cur_f += 1
        else:
            out_chunks.append(encode_tag(sc, sb))
    out_chunks.append(encode_tag(0, b""))
    duration = max(1, t_end - t_start + 1)
    return struct.pack("<HH", new_sid, cutoff) + b"".join(out_chunks), duration


def inject_sprite_controller(sprite_body: bytes, anim: str, is_skill: bool = False) -> bytes:
    sp_id, sp_fc = struct.unpack("<HH", sprite_body[:4])
    sub_tags = parse_tags(sprite_body, 4)

    if is_skill:
        out_chunks = []
        cur_f = 1
        for sc, sb in sub_tags:
            if sc in (12, 14, 15, 18, 19, 45):
                continue
            if sc == 1:
                if cur_f == sp_fc:
                    out_chunks.append(encode_tag(12, avm1_stop()))
                out_chunks.append(encode_tag(1, b""))
                cur_f += 1
            else:
                out_chunks.append(encode_tag(sc, sb))
        return struct.pack("<HH", sp_id, sp_fc) + b"".join(out_chunks)

    _, _, _, segments = parse_sprite_segments(sprite_body)
    sb_start, sb_end = segments.get("standby", (1, sp_fc))
    target_lbl = anim
    if target_lbl not in segments:
        for k in segments:
            if k.startswith(target_lbl.split("_")[0]):
                target_lbl = k
                break
    t_start, t_end = segments.get(target_lbl, (sb_start, sb_end))

    frame_actions = {}
    if anim == "standby" or target_lbl == "standby":
        if sb_start > 1:
            frame_actions[1] = avm1_goto_and_play(sb_start)
        frame_actions[sb_end] = avm1_goto_and_play(sb_start)
    elif anim in ("dead", "win"):
        if t_start > 1:
            frame_actions[1] = avm1_goto_and_play(t_start)
        frame_actions[t_end] = avm1_stop()
    else:
        loop_sb_start = max(2, sb_start) if t_start > 1 else sb_start
        if t_start > 1:
            frame_actions[1] = avm1_goto_and_play(t_start)
        frame_actions[t_end] = avm1_goto_and_play(loop_sb_start)
        frame_actions[sb_end] = avm1_goto_and_play(loop_sb_start)

    out_chunks = []
    cur_f = 1
    for sc, sb in sub_tags:
        if sc in (12, 14, 15, 18, 19, 45):
            continue
        if sc == 1:
            if cur_f in frame_actions:
                out_chunks.append(encode_tag(12, frame_actions[cur_f]))
            out_chunks.append(encode_tag(1, b""))
            cur_f += 1
        else:
            out_chunks.append(encode_tag(sc, sb))

    return struct.pack("<HH", sp_id, sp_fc) + b"".join(out_chunks)


def cmd_build_entity(input_path: str, output_path: str, anim: str, preview: bool = False):
    data = decompress_swf(input_path)
    version, _, _, tag_start = parse_header(data)
    tags = parse_tags(data, tag_start)

    stem = os.path.splitext(os.path.basename(input_path))[0].split(" ")[0]
    ignore_names = {
        "enemy_head",
        "npc_head",
        "pet_head",
        "StaticFullBody",
        "PetStaticFullBody",
        "StatichuntingHouse",
        "icon",
    }

    sprites = {}
    root_candidates = []
    for c, b in tags:
        if c == 39:
            sid, sfc = struct.unpack("<HH", b[:4])
            sprites[sid] = (sfc, b)
        elif c == 26:
            _, dp, cid, nm = parse_place2_info(b)
            if cid is not None:
                root_candidates.append((dp, cid, nm))

    main_sid = None
    for _, cid, nm in root_candidates:
        if nm == stem and cid in sprites:
            main_sid = cid
            break
    if main_sid is None:
        for _, cid, nm in root_candidates:
            if nm not in ignore_names and not (nm or "").startswith("Skill_") and cid in sprites:
                if sprites[cid][0] > 1:
                    main_sid = cid
                    break
    if main_sid is None and sprites:
        main_sid = max(sprites.keys(), key=lambda k: sprites[k][0])

    out_tags = [encode_tag(69, b"\x20\x00\x00\x00")]
    for c, b in tags:
        if c in (0, 1, 14, 15, 18, 19, 26, 45, 69, 76, 82, 86):
            continue
        if c == 39 and struct.unpack("<H", b[:2])[0] == main_sid:
            b = inject_sprite_controller(b, anim, is_skill=False)
        out_tags.append(encode_tag(c, b))

    if main_sid is not None:
        if preview:
            # Auto-fit pet frame-1 bounds into 340x280, centered, facing right (negative X scale)
            shapes_map = {}
            sprites_map = {}
            for tc, tb in tags:
                if tc in (2, 22, 32, 83) and len(tb) >= 4:
                    shapes_map[struct.unpack("<H", tb[:2])[0]] = parse_rect_px(tb, 2)[:4]
                elif tc == 39 and len(tb) >= 4:
                    sprites_map[struct.unpack("<H", tb[:2])[0]] = tb

            def _parse_mat(buf: bytes, pos: int):
                bp = pos * 8
                def _rb(n: int) -> int:
                    nonlocal bp
                    v = 0
                    for _ in range(n):
                        v = (v << 1) | ((buf[bp >> 3] >> (7 - (bp & 7))) & 1)
                        bp += 1
                    return v
                def _rsb(n: int) -> int:
                    v = _rb(n)
                    if n > 0 and (v & (1 << (n - 1))):
                        v -= (1 << n)
                    return v
                sx, sy, r0, r1 = 1.0, 1.0, 0.0, 0.0
                if _rb(1):
                    nb = _rb(5)
                    sx = _rsb(nb) / 65536.0
                    sy = _rsb(nb) / 65536.0
                if _rb(1):
                    nb = _rb(5)
                    r0 = _rsb(nb) / 65536.0
                    r1 = _rsb(nb) / 65536.0
                nb = _rb(5)
                tx = _rsb(nb) / 20.0
                ty = _rsb(nb) / 20.0
                return sx, sy, r0, r1, tx, ty

            def _first_bounds(cid: int, vis=None):
                if vis is None:
                    vis = set()
                if cid in vis:
                    return None
                vis.add(cid)
                if cid in shapes_map:
                    return shapes_map[cid]
                if cid not in sprites_map:
                    return None
                xs, ys = [], []
                for sc, sbody in parse_tags(sprites_map[cid], 4):
                    if sc == 1:
                        break
                    if sc == 26 and (sbody[0] & 0x02):
                        ccid = struct.unpack("<H", sbody[3:5])[0]
                        mat = _parse_mat(sbody, 5) if (sbody[0] & 0x04) else (1.0, 1.0, 0.0, 0.0, 0.0, 0.0)
                        r = _first_bounds(ccid, vis.copy())
                    elif sc == 70 and (sbody[0] & 0x02):
                        ccid = struct.unpack("<H", sbody[4:6])[0]
                        mat = _parse_mat(sbody, 6) if (sbody[0] & 0x04) else (1.0, 1.0, 0.0, 0.0, 0.0, 0.0)
                        r = _first_bounds(ccid, vis.copy())
                    else:
                        continue
                    if r:
                        msx, msy, mr0, mr1, mtx, mty = mat
                        for bx in (r[0], r[1]):
                            for by in (r[2], r[3]):
                                xs.append(bx * msx + by * mr1 + mtx)
                                ys.append(bx * mr0 + by * msy + mty)
                return (min(xs), max(xs), min(ys), max(ys)) if xs else None

            pb = _first_bounds(main_sid)
            if pb and (pb[1] - pb[0]) > 5.0 and (pb[3] - pb[2]) > 5.0:
                bw = pb[1] - pb[0]
                bh = pb[3] - pb[2]
                sc_fit = min(250.0 / bw, 215.0 / bh)
                sc_fit = max(0.55, min(1.55, sc_fit))
                cx = (pb[0] + pb[1]) / 2.0
                cy = (pb[2] + pb[3]) / 2.0
                ptx = 170.0 + sc_fit * cx
                pty = 144.0 - sc_fit * cy
                out_tags.append(encode_place_object2(1, main_sid, ptx, pty, -sc_fit, sc_fit))
            else:
                out_tags.append(encode_place_object2(1, main_sid, 155.0, 248.0, -0.78, 0.78))
        else:
            out_tags.append(encode_place_object2(1, main_sid, ENEMY_TX, ENEMY_TY, CHAR_SCALE, CHAR_SCALE))
    out_tags.append(encode_tag(1, b""))
    out_tags.append(encode_tag(0, b""))

    rect = encode_rect(0, 340, 0, 280) if preview else encode_rect(0, ARENA_W, 0, ARENA_H)
    swf_bytes = build_swf(version, rect, FPS_36_FIXED, 1, b"".join(out_tags))
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(swf_bytes)


def encode_cxform_color(rgb_int: int) -> bytes:
    """
    Encodes a SWF CXFORMWITHALPHA equivalent to ActionScript ColorTransform.color = rgb_int:
    R' = 0*R + r, G' = 0*G + g, B' = 0*B + b, A' = 1.0*A + 0.
    """
    r = (rgb_int >> 16) & 0xFF
    g = (rgb_int >> 8) & 0xFF
    b = rgb_int & 0xFF
    vals = [0, 0, 0, 256, r, g, b, 0]
    nbits = max(2, sbits_len(vals))
    return pack_bits([
        (1, 1),   # HasAddTerms = 1
        (1, 1),   # HasMultTerms = 1
        (nbits, 4),
        (0, nbits), (0, nbits), (0, nbits), (256, nbits),
        (r, nbits), (g, nbits), (b, nbits), (0, nbits),
    ])


def inject_cxform_into_place2(body: bytes, cxform_bytes: bytes) -> bytes:
    """Replaces or inserts a CXFORMWITHALPHA inside a PlaceObject2 (tag 26) body."""
    flags = body[0]
    pos = 3
    if flags & 0x02:
        pos += 2
    if flags & 0x04:
        pos = skip_matrix(body, pos)
    after_cx = skip_cxform(body, pos) if (flags & 0x08) else pos
    new_flags = flags | 0x08
    return bytes([new_flags]) + body[1:pos] + cxform_bytes + body[after_cx:]


def parse_hair_colors(hair_color: str):
    """Parses Ninja Saga hair_color 'primaryInt|secondaryInt' into (rgb1, rgb2) or None."""
    if not hair_color or hair_color.strip() in ("", "null|null"):
        return None
    parts = hair_color.split("|")
    try:
        c1 = int(parts[0].strip())
    except Exception:
        return None
    try:
        c2 = int(parts[1].strip()) if len(parts) > 1 and parts[1].strip() != "" else 0
    except Exception:
        c2 = 0
    if c1 == 0 and c2 == 0:
        return (0x1B1F2A, 0x0F131C)  # Rich ninja black with subtle darker shading
    if c2 == 0:
        r = max(0, int(((c1 >> 16) & 0xFF) * 0.72))
        g = max(0, int(((c1 >> 8) & 0xFF) * 0.72))
        b = max(0, int((c1 & 0xFF) * 0.72))
        c2 = (r << 16) | (g << 8) | b
    return (c1 & 0xFFFFFF, c2 & 0xFFFFFF)


def load_remapped_item_parts(item_swf_path: str, id_offset: int, hair_rgb_pair=None):
    if not os.path.isfile(item_swf_path):
        return [], {}
    data = decompress_swf(item_swf_path)
    _, _, _, tag_start = parse_header(data)
    tags = parse_tags(data, tag_start)

    cx1 = encode_cxform_color(hair_rgb_pair[0]) if hair_rgb_pair else None
    cx2 = encode_cxform_color(hair_rgb_pair[1]) if hair_rgb_pair else None

    remapped_tags = []
    part_map = {}

    for c, b in tags:
        if c in DEFINITION_TAGS:
            old_id = struct.unpack("<H", b[:2])[0]
            new_id = old_id + id_offset
            if c == 39:
                sfc = struct.unpack("<H", b[2:4])[0]
                sub_chunks = []
                for sc, sb in parse_tags(b, 4):
                    if sc in (14, 15, 18, 19, 45):
                        continue
                    if sc == 26:
                        if sb[0] & 0x02:
                            ref_id = struct.unpack("<H", sb[3:5])[0] + id_offset
                            sb = sb[:3] + struct.pack("<H", ref_id) + sb[5:]
                        if cx1 is not None:
                            _, _, _, child_nm = parse_place2_info(sb)
                            if child_nm == "hair_color_1":
                                sb = inject_cxform_into_place2(sb, cx1)
                            elif child_nm == "hair_color_2" and cx2 is not None:
                                sb = inject_cxform_into_place2(sb, cx2)
                    elif sc == 70:
                        _, _, _, cid, _, cpos = parse_place3_info(sb)
                        if cid is not None and cpos is not None:
                            sb = sb[:cpos] + struct.pack("<H", cid + id_offset) + sb[cpos + 2 :]
                    sub_chunks.append(encode_tag(sc, sb))
                b = struct.pack("<HH", new_id, sfc) + b"".join(sub_chunks)
            else:
                b = struct.pack("<H", new_id) + b[2:]
            remapped_tags.append(encode_tag(c, b))
        elif c == 26:
            _, _, cid, nm = parse_place2_info(b)
            if cid is not None and nm and nm != "icon":
                part_map[nm] = cid + id_offset

    return remapped_tags, part_map


def load_player_equipment_tags(
    items_dir: str,
    gender: int,
    hair: str,
    clothing: str,
    weapon: str,
    back: str,
    hair_color: str = "",
):
    g_suffix = "_0" if int(gender) == 0 else "_1"
    face_file = os.path.join(items_dir, f"face_01{g_suffix}.swf")

    def resolve_item(name: str, fallback: str) -> str:
        if not name:
            name = fallback
        if not name.endswith(".swf"):
            name += ".swf"
        p = os.path.join(items_dir, name)
        if not os.path.isfile(p) and fallback:
            p = os.path.join(items_dir, fallback if fallback.endswith(".swf") else f"{fallback}.swf")
        return p

    hair_rgb_pair = parse_hair_colors(hair_color)
    item_files = [
        (face_file, 10000, None),
        (resolve_item(hair, f"hair_01{g_suffix}.swf"), 12000, hair_rgb_pair),
        (resolve_item(clothing, f"set_01{g_suffix}.swf"), 14000, None),
        (resolve_item(weapon, "wpn_01.swf"), 18000, None),
        (resolve_item(back, "back_01.swf"), 20000, None),
    ]

    extra_def_tags = []
    parts_by_name = {}
    for fpath, offset, h_rgb in item_files:
        rtags, pmap = load_remapped_item_parts(fpath, offset, hair_rgb_pair=h_rgb)
        extra_def_tags.extend(rtags)
        parts_by_name.update(pmap)

    if "back_item" in parts_by_name and "back" not in parts_by_name:
        parts_by_name["back"] = parts_by_name["back_item"]

    return extra_def_tags, parts_by_name


def load_dressed_skill_defs(skill_swf_path: str, id_offset: int, parts_by_name: dict):
    """
    Loads a skill SWF, dresses its 19 body-part holder sprites with parts_by_name (already remapped),
    shifts the skill's own definitions by id_offset, adds ActionStop on its final frame,
    and returns (def_tag_bytes_list, main_skill_remapped_sid, skill_frame_count).
    """
    data = decompress_swf(skill_swf_path)
    _, _, _, tag_start = parse_header(data)
    tags = parse_tags(data, tag_start)

    sprites = {}
    root_candidates = []
    for c, b in tags:
        if c == 39:
            sid, sfc = struct.unpack("<HH", b[:4])
            sprites[sid] = (sfc, b)
        elif c == 26:
            _, dp, cid, nm = parse_place2_info(b)
            if cid is not None:
                root_candidates.append((dp, cid, nm))

    main_sid = None
    for _, cid, nm in root_candidates:
        if nm != "icon" and cid in sprites:
            main_sid = cid
            break
    if main_sid is None and sprites:
        main_sid = max(sprites.keys(), key=lambda k: sprites[k][0])

    holder_sid_to_part = {}
    if main_sid in sprites:
        for sc, sb in parse_tags(sprites[main_sid][1], 4):
            if sc == 1:
                break
            if sc == 70:
                _, _, _, cid, nm, _ = parse_place3_info(sb)
                if cid and nm:
                    holder_sid_to_part[cid] = nm
            elif sc == 26:
                _, _, cid, nm = parse_place2_info(sb)
                if cid and nm:
                    holder_sid_to_part[cid] = nm

    out_defs = []
    skill_fc = sprites[main_sid][0] if main_sid in sprites else 45

    # Identify unused 'icon' sprite IDs so we don't bloat battle SWFs with unreachable icon assets
    icon_root_cids = {cid for _, cid, nm in root_candidates if nm == "icon" and cid != main_sid}
    reachable_cids = set()
    if main_sid is not None:
        defs_by_id = {}
        for c, b in tags:
            if c in DEFINITION_TAGS and c not in (14,) and len(b) >= 2:
                defs_by_id[struct.unpack("<H", b[:2])[0]] = (c, b)
        queue = [main_sid]
        while queue:
            cur_id = queue.pop()
            if cur_id in reachable_cids or cur_id not in defs_by_id:
                continue
            reachable_cids.add(cur_id)
            dc, db = defs_by_id[cur_id]
            if dc == 39:
                for sc, sb_b in parse_tags(db, 4):
                    if sc == 26 and (sb_b[0] & 0x02):
                        rc = struct.unpack("<H", sb_b[3:5])[0]
                        if rc not in reachable_cids:
                            queue.append(rc)
                    elif sc == 70:
                        _, _, _, rc, _, _ = parse_place3_info(sb_b)
                        if rc is not None and rc not in reachable_cids:
                            queue.append(rc)
            elif dc in (2, 22, 32, 83):
                for bmp_id in extract_shape_bitmap_ids(dc, db):
                    if bmp_id not in reachable_cids:
                        queue.append(bmp_id)

    for c, b in tags:
        if c not in DEFINITION_TAGS or c in (14,):
            continue
        old_id = struct.unpack("<H", b[:2])[0]
        if old_id in icon_root_cids:
            continue
        if reachable_cids and old_id not in reachable_cids:
            continue
        new_id = old_id + id_offset
        if c == 39:
            sfc = struct.unpack("<H", b[2:4])[0]
            part_name = holder_sid_to_part.get(old_id)
            sub_chunks = []
            cur_f = 1
            for sc, sb in parse_tags(b, 4):
                if sc in (12, 14, 15, 18, 19, 45):
                    continue
                if sc == 70:
                    _, _, dp, ref_cid, snm, cpos = parse_place3_info(sb)
                    if part_name == "weapon" and snm != "holderMc" and "weapon" in parts_by_name:
                        continue
                    if ref_cid is not None and cpos is not None:
                        replaced = False
                        if part_name:
                            target_part = snm if part_name == "head" and snm in ("face", "hair") else part_name
                            if (snm in ("holderMc", "face", "hair") or (part_name == "back" and dp == 1)) and target_part in parts_by_name:
                                sb = sb[:cpos] + struct.pack("<H", parts_by_name[target_part]) + sb[cpos + 2 :]
                                replaced = True
                        if not replaced:
                            sb = sb[:cpos] + struct.pack("<H", ref_cid + id_offset) + sb[cpos + 2 :]
                    sb = optimize_place3_for_mobile_gpu(sb)
                elif sc == 26 and (sb[0] & 0x02):
                    _, dp, ref_cid, snm = parse_place2_info(sb)
                    if part_name == "weapon" and snm != "holderMc" and "weapon" in parts_by_name:
                        continue
                    replaced = False
                    if part_name:
                        target_part = snm if part_name == "head" and snm in ("face", "hair") else part_name
                        if (snm in ("holderMc", "face", "hair") or (part_name == "back" and dp == 1)) and target_part in parts_by_name:
                            sb = sb[:3] + struct.pack("<H", parts_by_name[target_part]) + sb[5:]
                            replaced = True
                    if not replaced:
                        sb = sb[:3] + struct.pack("<H", ref_cid + id_offset) + sb[5:]
                elif sc == 1:
                    if old_id == main_sid and cur_f == sfc:
                        sub_chunks.append(encode_tag(12, avm1_stop()))
                    cur_f += 1
                sub_chunks.append(encode_tag(sc, sb))
            b = struct.pack("<HH", new_id, sfc) + b"".join(sub_chunks)
        else:
            b = struct.pack("<H", new_id) + b[2:]
        out_defs.append(encode_tag(c, b))

    return out_defs, (main_sid + id_offset if main_sid else None), skill_fc


def cmd_build_skill(input_path: str, output_path: str):
    skills_dir = os.path.dirname(os.path.abspath(input_path))
    items_dir = os.path.join(os.path.dirname(skills_dir), "items")
    cmd_build_player_skill(
        input_path,
        items_dir,
        output_path,
        0,
        "hair_01_0",
        "set_01_0",
        "wpn_01",
        "back_01",
    )


def cmd_build_player_skill(
    skill_swf_path: str,
    items_dir: str,
    output_path: str,
    gender: int,
    hair: str,
    clothing: str,
    weapon: str,
    back: str,
):
    extra_def_tags, parts_by_name = load_player_equipment_tags(
        items_dir, gender, hair, clothing, weapon, back
    )
    skill_defs, main_skill_sid, _ = load_dressed_skill_defs(skill_swf_path, 30000, parts_by_name)

    # 2.5x zoomed-in Academy skill preview stage (CHAR_SCALE 0.25 * 2.5 = 0.625)
    PREVIEW_W = 640
    PREVIEW_H = 360
    PREVIEW_SCALE = CHAR_SCALE * 2.5
    PREVIEW_TX = 185.0
    PREVIEW_TY = 265.0

    out_tags = [encode_tag(69, b"\x20\x00\x00\x00")]
    out_tags.extend(extra_def_tags)
    out_tags.extend(skill_defs)
    if main_skill_sid is not None:
        out_tags.append(encode_place_object2(1, main_skill_sid, PREVIEW_TX, PREVIEW_TY, -PREVIEW_SCALE, PREVIEW_SCALE))
    out_tags.append(encode_tag(1, b""))
    out_tags.append(encode_tag(0, b""))

    rect = encode_rect(0, PREVIEW_W, 0, PREVIEW_H)
    swf_bytes = build_swf(19, rect, FPS_36_FIXED, 1, b"".join(out_tags))
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(swf_bytes)


def cmd_build_skill_icons(skills_dir: str, skills_csv: str, output_path: str):
    """
    Compiles a compact 1-frame horizontal sprite-sheet SWF containing the authentic
    50x50 'icon' vector sprite from up to 12 asset SWFs (skills/items/materials/pets, 64x64 cell per icon).
    """
    skill_ids = [s.strip() for s in skills_csv.split(",") if s.strip()][:12]
    if not skill_ids:
        skill_ids = ["skill_01"]

    CELL = 128
    out_tags = [encode_tag(69, b"\x20\x00\x00\x00")]
    placed = []

    for idx, raw_id in enumerate(skill_ids):
        sk_id = raw_id.replace(".swf", "")
        sk_path = os.path.join(skills_dir, f"{sk_id}.swf")
        if not os.path.isfile(sk_path):
            parent_dir = os.path.dirname(os.path.abspath(skills_dir))
            for sib in ("materials", "essentials", "items", "consumables", "pets", "skills"):
                cand = os.path.join(parent_dir, sib, f"{sk_id}.swf")
                if os.path.isfile(cand):
                    sk_path = cand
                    break
        if not os.path.isfile(sk_path):
            fallback = os.path.join(skills_dir, "skill_01.swf")
            if os.path.isfile(fallback):
                sk_path = fallback
            else:
                continue

        try:
            d = decompress_swf(sk_path)
            _, _, _, ts = parse_header(d)
            tags = parse_tags(d, ts)
            icon_cid = None
            fallback_cid = None
            defs_by_id = {}
            for c, b in tags:
                if c in DEFINITION_TAGS and c not in (14,) and len(b) >= 2:
                    cid = struct.unpack("<H", b[:2])[0]
                    defs_by_id[cid] = (c, b)
                elif c == 26:
                    _, _, cid, nm = parse_place2_info(b)
                    if nm == "icon" and cid is not None:
                        icon_cid = cid
                    elif nm in ("pet_head", "upper_body", "weapon", "back_item", "hair") and cid is not None and fallback_cid is None:
                        fallback_cid = cid
                elif c == 70:
                    _, _, _, cid, nm, _ = parse_place3_info(b)
                    if nm == "icon" and cid is not None:
                        icon_cid = cid
                    elif nm in ("pet_head", "upper_body", "weapon", "back_item", "hair") and cid is not None and fallback_cid is None:
                        fallback_cid = cid
            if icon_cid is None:
                icon_cid = fallback_cid
            if icon_cid is None or icon_cid not in defs_by_id:
                continue

            # Collect only definitions referenced by icon_cid (BFS)
            needed = set()
            queue = [icon_cid]
            while queue:
                cur = queue.pop(0)
                if cur in needed or cur not in defs_by_id:
                    continue
                needed.add(cur)
                dc, db = defs_by_id[cur]
                if dc == 39:
                    for sc, sb_b in parse_tags(db, 4):
                        if sc == 26 and (sb_b[0] & 0x02):
                            ref = struct.unpack("<H", sb_b[3:5])[0]
                            queue.append(ref)
                        elif sc == 70:
                            _, _, _, ref_cid, _, _ = parse_place3_info(sb_b)
                            if ref_cid is not None:
                                queue.append(ref_cid)
                elif dc in (2, 22, 32, 83):
                    # Also collect any BitmapId referenced by FillStyleArray in DefineShape/2/3/4!
                    for bmp_id in extract_shape_bitmap_ids(dc, db):
                        queue.append(bmp_id)

            id_offset = 1000 + idx * 500
            for cid in sorted(needed):
                dc, db = defs_by_id[cid]
                new_id = cid + id_offset
                if dc in (2, 22, 32, 83):
                    out_tags.append(encode_tag(dc, remap_shape_bitmap_ids(dc, db, id_offset)))
                elif dc == 39:
                    sfc = struct.unpack("<H", db[2:4])[0]
                    sub_chunks = []
                    for sc, sb_b in parse_tags(db, 4):
                        if sc in (12, 14, 15, 18, 19, 45):
                            continue
                        if sc == 26 and (sb_b[0] & 0x02):
                            ref = struct.unpack("<H", sb_b[3:5])[0] + id_offset
                            sb_b = sb_b[:3] + struct.pack("<H", ref) + sb_b[5:]
                        elif sc == 70:
                            _, _, _, ref_cid, _, cpos = parse_place3_info(sb_b)
                            if ref_cid is not None and cpos is not None:
                                sb_b = sb_b[:cpos] + struct.pack("<H", ref_cid + id_offset) + sb_b[cpos + 2 :]
                        sub_chunks.append(encode_tag(sc, sb_b))
                    out_tags.append(encode_tag(39, struct.pack("<HH", new_id, sfc) + b"".join(sub_chunks)))
                else:
                    out_tags.append(encode_tag(dc, struct.pack("<H", new_id) + db[2:]))

            # Skills SWFs ALWAYS use 50x50 top-left icons (x[0..50], y[0..50]);
            # Items/materials/consumables/essentials/pets ALWAYS use 100x100 bottom-centered icons (x[-50..50], y[-100..0]).
            actual_dir = os.path.basename(os.path.dirname(os.path.abspath(sk_path)))
            if actual_dir != "skills":
                placed.append((idx + 1, icon_cid + id_offset, idx * CELL + (CELL / 2.0), float(CELL), CELL / 100.0))
            else:
                # Fill the entire 128x128 HD cell edge-to-edge with the 50x50 vector icon (scale 2.56)
                placed.append((idx + 1, icon_cid + id_offset, idx * CELL, 0.0, CELL / 50.0))
        except Exception:
            continue

    for dp, cid, tx, ty, sc in placed:
        out_tags.append(encode_place_object2(dp, cid, tx, ty, sc, sc))

    out_tags.append(encode_tag(1, b""))
    out_tags.append(encode_tag(0, b""))

    rect = encode_rect(0, len(skill_ids) * CELL, 0, CELL)
    swf_bytes = build_swf(19, rect, 12 * 256, 1, b"".join(out_tags))
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(swf_bytes)


def cmd_extract_player_base(ninjasage_swf_path: str, output_base_path: str):
    data = decompress_swf(ninjasage_swf_path)
    version, _, _, tag_start = parse_header(data)
    tags = parse_tags(data, tag_start)

    defs_in_order = []
    defs_by_id = {}
    for c, b in tags:
        if c in DEFINITION_TAGS:
            cid = struct.unpack("<H", b[:2])[0]
            if c == 39 and cid in (531, 532):
                b = struct.pack("<HH", cid, 1) + encode_tag(1, b"") + encode_tag(0, b"")
            elif c == 39 and cid == 698:
                # Truncate Sprite #698 at Frame 427 (includes complete authentic 30-frame 'item' scroll animation 398..427,
                # while still dropping 484 unused seasonal emote frames!)
                sub_chunks = []
                cf = 1
                for sc, sb in parse_tags(b, 4):
                    if sc in (0, 12, 14, 15, 18, 19, 45):
                        continue
                    sub_chunks.append(encode_tag(sc, sb))
                    if sc == 1:
                        if cf >= 427:
                            break
                        cf += 1
                sub_chunks.append(encode_tag(0, b""))
                b = struct.pack("<HH", 698, min(cf, 427)) + b"".join(sub_chunks)
            defs_in_order.append((cid, c, b))
            defs_by_id[cid] = (c, b)

    needed = set()
    stack = [698]
    while stack:
        cur = stack.pop()
        if cur in needed or cur not in defs_by_id:
            continue
        needed.add(cur)
        code, body = defs_by_id[cur]
        if code == 39:
            for sc, sb in parse_tags(body, 4):
                if sc == 26 and (sb[0] & 0x02):
                    stack.append(struct.unpack("<H", sb[3:5])[0])
                elif sc == 70 and (sb[0] & 0x02):
                    stack.append(struct.unpack("<H", sb[4:6])[0])

    out_tags = [encode_tag(69, b"\x20\x00\x00\x00")]
    for cid, c, b in defs_in_order:
        if cid in needed:
            out_tags.append(encode_tag(c, b))
    out_tags.append(encode_place_object2(1, 698, PLAYER_TX, PLAYER_TY, -CHAR_SCALE, CHAR_SCALE))
    out_tags.append(encode_tag(1, b""))
    out_tags.append(encode_tag(0, b""))

    rect = encode_rect(0, ARENA_W, 0, ARENA_H)
    swf_bytes = build_swf(version, rect, FPS_36_FIXED, 1, b"".join(out_tags))
    os.makedirs(os.path.dirname(os.path.abspath(output_base_path)), exist_ok=True)
    with open(output_base_path, "wb") as f:
        f.write(swf_bytes)


def cmd_build_player(
    base_swf_path: str,
    items_dir: str,
    output_path: str,
    anim: str,
    gender: int,
    hair: str,
    clothing: str,
    weapon: str,
    back: str,
    bg_swf_path: str = "",
    hair_color: str = "",
):
    data = decompress_swf(base_swf_path)
    version, _, _, tag_start = parse_header(data)
    base_tags = parse_tags(data, tag_start)

    extra_def_tags, parts_by_name = load_player_equipment_tags(
        items_dir, gender, hair, clothing, weapon, back, hair_color=hair_color
    )
    slot_replacements = {}
    for part_name, new_cid in parts_by_name.items():
        if part_name in PLAYER_PART_SLOTS:
            slot_replacements[PLAYER_PART_SLOTS[part_name]] = new_cid

    out_tags = [encode_tag(69, b"\x20\x00\x00\x00")]
    out_tags.extend(extra_def_tags)

    for c, b in base_tags:
        if c in (0, 1, 26, 69):
            continue
        if c == 39:
            sid, sfc = struct.unpack("<HH", b[:4])
            if 508 <= sid <= 526:
                sub_chunks = []
                for sc, sb in parse_tags(b, 4):
                    if sc == 26 and (sb[0] & 0x02):
                        dp = struct.unpack("<H", sb[1:3])[0]
                        old_cid = struct.unpack("<H", sb[3:5])[0]
                        # Drop baked-in default kunai/knife placeholder (cid=523 at depth 4) inside weapon holder 524
                        if sid == 524 and dp == 4 and (524, 1) in slot_replacements:
                            continue
                        if old_cid == 507 and (sid, dp) in slot_replacements:
                            new_cid = slot_replacements[(sid, dp)]
                            sb = sb[:3] + struct.pack("<H", new_cid) + sb[5:]
                    sub_chunks.append(encode_tag(sc, sb))
                b = struct.pack("<HH", sid, sfc) + b"".join(sub_chunks)
            elif sid == 698:
                b = inject_sprite_controller(b, anim, is_skill=False)
        out_tags.append(encode_tag(c, b))

    if bg_swf_path == "__portrait__":
        # Authentic Ninja Saga head portrait: Sprite 521 (face + hair + hair_color, 1 frame)
        # Local bounds of Sprite 521 are ~x=[-23.2, 22.6], y=[-26.5, 26.0] (center ~(-0.3, -0.3)).
        # Scale 2.95x centered at (78, 82) fills ~90% of the 160x160 portrait frame cleanly.
        out_tags.append(encode_place_object2(1, 521, 78.0, 82.0, -2.95, 2.95))
        rect = encode_rect(0, 160, 0, 160)
    elif bg_swf_path and os.path.isfile(bg_swf_path):
        bg_def_tags, bg_cid, bg_w, bg_h = load_mission_bg_defs(bg_swf_path, id_offset=45000)
        out_tags.extend(bg_def_tags)
        if bg_cid is not None:
            bg_scale = max(ARENA_W / float(bg_w), ARENA_H / float(bg_h))
            bg_tx = (ARENA_W - bg_w * bg_scale) / 2.0
            bg_ty = (ARENA_H - bg_h * bg_scale) / 2.0
            out_tags.append(encode_place_object2(1, bg_cid, bg_tx, bg_ty, bg_scale, bg_scale, name="bg"))
        # Place player standing cleanly in the Fire Village plaza (left-center)
        out_tags.append(encode_place_object2(2, 698, 200.0, 342.0, -0.42, 0.42))
        rect = encode_rect(0, ARENA_W, 0, ARENA_H)
    else:
        # Centered large full-body character preview (for Profile, Gear, Create Ninja & Shop Fitting Room)
        # Shifted 70px left (tx=90) so the character sits cleanly centered in the stage frame
        out_tags.append(encode_place_object2(1, 698, 90.0, 264.0, -0.95, 0.95))
        rect = encode_rect(0, 320, 0, 300)

    out_tags.append(encode_tag(1, b""))
    out_tags.append(encode_tag(0, b""))

    swf_bytes = build_swf(version, rect, FPS_36_FIXED, 1, b"".join(out_tags))
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(swf_bytes)


def parse_rect_px(buf: bytes, pos: int):
    """Parses a SWF RECT structure and returns (xmin_px, xmax_px, ymin_px, ymax_px, end_pos)."""
    bit_pos = pos * 8
    def rbits(n):
        nonlocal bit_pos
        v = 0
        for _ in range(n):
            v = (v << 1) | ((buf[bit_pos >> 3] >> (7 - (bit_pos & 7))) & 1)
            bit_pos += 1
        return v
    def rsbits(n):
        v = rbits(n)
        if n > 0 and (v & (1 << (n - 1))):
            v -= (1 << n)
        return v
    nbits = rbits(5)
    xmin = rsbits(nbits) / 20.0
    xmax = rsbits(nbits) / 20.0
    ymin = rsbits(nbits) / 20.0
    ymax = rsbits(nbits) / 20.0
    return xmin, xmax, ymin, ymax, (bit_pos + 7) // 8


def extract_shape_bitmap_ids(tag_code: int, body: bytes):
    """Returns all BitmapId values referenced in a DefineShape/2/3/4 FillStyleArray."""
    ids = []
    if len(body) < 4:
        return ids
    try:
        _, _, _, _, pos = parse_rect_px(body, 2)
        if tag_code == 83:
            # DefineShape4 has EdgeBounds (RECT) + 1 byte flags before FillStyleArray
            _, _, _, _, pos = parse_rect_px(body, pos)
            pos += 1
        if pos >= len(body):
            return ids
        fill_count = body[pos]
        pos += 1
        if fill_count == 0xFF and pos + 2 <= len(body):
            fill_count = struct.unpack("<H", body[pos:pos + 2])[0]
            pos += 2
        has_alpha = tag_code in (32, 83)
        for _ in range(fill_count):
            if pos >= len(body):
                break
            ftype = body[pos]
            pos += 1
            if ftype == 0x00:
                pos += 4 if has_alpha else 3
            elif ftype in (0x10, 0x12, 0x13):
                pos = skip_matrix(body, pos)
                if pos >= len(body):
                    break
                grad_cnt = body[pos] & 0x0F
                pos += 1 + grad_cnt * (5 if has_alpha else 4)
                if ftype == 0x13:
                    pos += 2
            elif ftype in (0x40, 0x41, 0x42, 0x43):
                if pos + 2 <= len(body):
                    old_bmp = struct.unpack("<H", body[pos:pos + 2])[0]
                    if old_bmp != 0xFFFF:
                        ids.append(old_bmp)
                pos += 2
                pos = skip_matrix(body, pos)
    except Exception:
        pass
    return ids


def remap_shape_bitmap_ids(tag_code: int, body: bytes, id_offset: int) -> bytes:
    """Remaps ShapeId and any BitmapId entries inside DefineShape/2/3/4 FillStyleArray."""
    if len(body) < 4:
        return body
    old_id = struct.unpack("<H", body[:2])[0]
    new_id = old_id + id_offset
    out = bytearray(struct.pack("<H", new_id) + body[2:])
    try:
        _, _, _, _, pos = parse_rect_px(body, 2)
        if tag_code == 83:
            # DefineShape4 has EdgeBounds (RECT) + 1 byte flags before FillStyleArray
            _, _, _, _, pos = parse_rect_px(body, pos)
            pos += 1
        if pos >= len(body):
            return bytes(out)
        fill_count = body[pos]
        pos += 1
        if fill_count == 0xFF and pos + 2 <= len(body):
            fill_count = struct.unpack("<H", body[pos:pos + 2])[0]
            pos += 2
        has_alpha = tag_code in (32, 83)
        for _ in range(fill_count):
            if pos >= len(body):
                break
            ftype = body[pos]
            pos += 1
            if ftype == 0x00:
                pos += 4 if has_alpha else 3
            elif ftype in (0x10, 0x12, 0x13):
                pos = skip_matrix(body, pos)
                if pos >= len(body):
                    break
                grad_cnt = body[pos] & 0x0F
                pos += 1 + grad_cnt * (5 if has_alpha else 4)
                if ftype == 0x13:
                    pos += 2
            elif ftype in (0x40, 0x41, 0x42, 0x43):
                if pos + 2 <= len(body):
                    old_bmp = struct.unpack("<H", body[pos:pos + 2])[0]
                    if old_bmp != 0xFFFF:
                        struct.pack_into("<H", out, pos, old_bmp + id_offset)
                pos += 2
                pos = skip_matrix(body, pos)
            else:
                break
    except Exception:
        pass
    return bytes(out)


def load_mission_bg_defs(bg_swf_path: str, id_offset: int = 45000):
    """
    Loads a mission background SWF (e.g. mission_01.swf), remaps all definitions by id_offset,
    and returns (def_tags, bg_cid, bg_w, bg_h).
    """
    if not bg_swf_path or not os.path.isfile(bg_swf_path):
        return [], None, 960.0, 550.0
    bg_data = decompress_swf(bg_swf_path)
    _, _, _, bg_tag_start = parse_header(bg_data)
    xmin, xmax, ymin, ymax, _ = parse_rect_px(bg_data, 8)
    bg_w = max(100.0, xmax - xmin)
    bg_h = max(100.0, ymax - ymin)
    bg_tags = parse_tags(bg_data, bg_tag_start)

    def_tags = []
    root_cid = None
    last_sprite_cid = None
    for c, b in bg_tags:
        if c == 26 and (b[0] & 0x02):
            _, _, cid, _ = parse_place2_info(b)
            if cid is not None and root_cid is None:
                root_cid = cid + id_offset
        if c not in DEFINITION_TAGS or c in (14,):
            continue
        if len(b) < 2:
            continue
        old_id = struct.unpack("<H", b[:2])[0]
        new_id = old_id + id_offset
        if c in (2, 22, 32):
            def_tags.append(encode_tag(c, remap_shape_bitmap_ids(c, b, id_offset)))
        elif c == 39:
            sfc = struct.unpack("<H", b[2:4])[0]
            sub_chunks = []
            for sc, sb in parse_tags(b, 4):
                if sc in (12, 14, 15, 18, 19, 45):
                    continue
                if sc == 26 and (sb[0] & 0x02):
                    ref_id = struct.unpack("<H", sb[3:5])[0] + id_offset
                    sb = sb[:3] + struct.pack("<H", ref_id) + sb[5:]
                elif sc == 70:
                    _, _, _, ref_cid, _, cpos = parse_place3_info(sb)
                    if ref_cid is not None and cpos is not None:
                        sb = sb[:cpos] + struct.pack("<H", ref_cid + id_offset) + sb[cpos + 2 :]
                    sb = optimize_place3_for_mobile_gpu(sb)
                sub_chunks.append(encode_tag(sc, sb))
            def_tags.append(encode_tag(39, struct.pack("<HH", new_id, sfc) + b"".join(sub_chunks)))
            last_sprite_cid = new_id
        else:
            def_tags.append(encode_tag(c, struct.pack("<H", new_id) + b[2:]))

    return def_tags, (root_cid or last_sprite_cid), bg_w, bg_h


def measure_skill_reach_px(skill_swf_path: str) -> float:
    """
    Measures the exact horizontal projectile travel distance (in stage px at CHAR_SCALE)
    by scanning PlaceObject2/3 translation tx across the skill SWF's sprites.
    """
    def _read_tx(buf: bytes, pos: int) -> float:
        bp = pos * 8
        def rbits(n):
            nonlocal bp
            v = 0
            for _ in range(n):
                v = (v << 1) | ((buf[bp >> 3] >> (7 - (bp & 7))) & 1)
                bp += 1
            return v
        def rsbits(n):
            v = rbits(n)
            if n > 0 and (v & (1 << (n - 1))):
                v -= (1 << n)
            return v
        if rbits(1):
            nb = rbits(5); rsbits(nb); rsbits(nb)
        if rbits(1):
            nb = rbits(5); rsbits(nb); rsbits(nb)
        nb = rbits(5)
        return rsbits(nb) / 20.0

    try:
        d = decompress_swf(skill_swf_path)
        _, _, _, ts = parse_header(d)
        min_tx = 0.0
        for c, b in parse_tags(d, ts):
            if c == 39:
                for sc, sb_b in parse_tags(b, 4):
                    if sc == 26 and (sb_b[0] & 0x04):
                        off = 3 + (2 if (sb_b[0] & 0x02) else 0)
                        tx = _read_tx(sb_b, off)
                        if tx < min_tx:
                            min_tx = tx
                    elif sc == 70 and (sb_b[0] & 0x04):
                        off = 4 + (2 if (sb_b[0] & 0x02) else 0)
                        tx = _read_tx(sb_b, off)
                        if tx < min_tx:
                            min_tx = tx
        reach = -min_tx * CHAR_SCALE
        if reach >= 100.0:
            return min(340.0, reach)
    except Exception:
        pass
    return 205.0


def cmd_build_battle(
    base_swf_path: str,
    items_dir: str,
    enemy_swf_path: str,
    skills_dir: str,
    output_path: str,
    gender: int,
    hair: str,
    clothing: str,
    weapon: str,
    back: str,
    skills_csv: str,
    bg_swf_path: str = "",
    allies_swf_path: str = "",
    ally_skills_csv: str = "",
):
    """
    Builds ONE unified 36 FPS Battle Stage SWF containing:
      - Player variants: 700 (standby), 701 (attack_01), 702 (charge), 703 (hit), 704 (win), 705 (dead)
      - Enemy variants:  800 (standby), 801 (attack_01), 802 (hit), 803 (dead)
      - Dressed Skill variants: 900 + i for each skill in skills_csv
      - Root timeline choreography with ExternalInterface (__pollCmd, __onHit, __onDone)
    """
    base_data = decompress_swf(base_swf_path)
    _, _, _, base_tag_start = parse_header(base_data)
    base_tags = parse_tags(base_data, base_tag_start)

    extra_def_tags, parts_by_name = load_player_equipment_tags(
        items_dir, gender, hair, clothing, weapon, back
    )
    slot_replacements = {}
    for part_name, new_cid in parts_by_name.items():
        if part_name in PLAYER_PART_SLOTS:
            slot_replacements[PLAYER_PART_SLOTS[part_name]] = new_cid

    out_tags = [encode_tag(69, b"\x20\x00\x00\x00")]
    out_tags.extend(extra_def_tags)

    # 1) Player base definitions + 6 variant sprites (700..705)
    raw_698_body = None
    for c, b in base_tags:
        if c in (0, 1, 26, 69):
            continue
        if c == 39:
            sid, sfc = struct.unpack("<HH", b[:4])
            if 508 <= sid <= 526:
                sub_chunks = []
                for sc, sb in parse_tags(b, 4):
                    if sc == 26 and (sb[0] & 0x02):
                        dp = struct.unpack("<H", sb[1:3])[0]
                        old_cid = struct.unpack("<H", sb[3:5])[0]
                        # Drop baked-in default kunai/knife placeholder (cid=523 at depth 4) inside weapon holder 524
                        if sid == 524 and dp == 4 and (524, 1) in slot_replacements:
                            continue
                        if old_cid == 507 and (sid, dp) in slot_replacements:
                            new_cid = slot_replacements[(sid, dp)]
                            sb = sb[:3] + struct.pack("<H", new_cid) + sb[5:]
                    sub_chunks.append(encode_tag(sc, sb))
                b = struct.pack("<HH", sid, sfc) + b"".join(sub_chunks)
                out_tags.append(encode_tag(c, b))
            elif sid == 698:
                raw_698_body = b
            else:
                out_tags.append(encode_tag(c, b))
        else:
            out_tags.append(encode_tag(c, b))

    p_standby_body, _ = build_variant_sprite(raw_698_body, 700, "standby", loop_self=True)
    p_attack_body, p_atk_dur = build_variant_sprite(raw_698_body, 701, "attack_01", loop_self=False)
    p_charge_body, p_chg_dur = build_variant_sprite(raw_698_body, 702, "charge", loop_self=False)
    p_hit_body, _ = build_variant_sprite(raw_698_body, 703, "hit", loop_self=False)
    p_win_body, _ = build_variant_sprite(raw_698_body, 704, "win", loop_self=False)
    p_dead_body, _ = build_variant_sprite(raw_698_body, 705, "dead", loop_self=False)
    p_run_body, _ = build_variant_sprite(raw_698_body, 706, "run", loop_self=True)
    p_item_body, p_item_dur = build_variant_sprite(raw_698_body, 707, "item", loop_self=False)

    for vb in (p_standby_body, p_attack_body, p_charge_body, p_hit_body, p_win_body, p_dead_body, p_run_body, p_item_body):
        out_tags.append(encode_tag(39, vb))

    # 2) Enemy definitions (1 to 3 simultaneous enemies, deduplicated by SWF path!)
    # Formation positions on the right side of the 760x360 arena
    enemy_paths = [p.strip() for p in enemy_swf_path.split(",") if p.strip()][:3]
    if not enemy_paths:
        raise ValueError("No enemy SWF paths provided")

    FORMATION_POS = {
        1: [(630.0, 255.0)],
        2: [(630.0, 255.0), (630.0, 168.0)],
        3: [(630.0, 255.0), (630.0, 168.0), (630.0, 328.0)],
    }
    slot_positions = FORMATION_POS[len(enemy_paths)]

    unique_enemy_meta = {}  # path -> (standby_cid, atk_cid, hit_cid, dead_cid, atk_dur)
    unique_idx = 0
    for ep in enemy_paths:
        if ep in unique_enemy_meta:
            continue
        ene_data = decompress_swf(ep)
        _, _, _, ene_tag_start = parse_header(ene_data)
        ene_tags = parse_tags(ene_data, ene_tag_start)
        ene_offset = 22000 + unique_idx * 2500
        ene_stem = os.path.splitext(os.path.basename(ep))[0].split(" ")[0]
        ene_sprites = {}
        ene_root_candidates = []

        for c, b in ene_tags:
            if c == 39:
                sid, sfc = struct.unpack("<HH", b[:4])
                ene_sprites[sid] = (sfc, b)
            elif c == 26:
                _, dp, cid, nm = parse_place2_info(b)
                if cid is not None:
                    ene_root_candidates.append((dp, cid, nm))

        ene_main_sid = None
        for _, cid, nm in ene_root_candidates:
            if nm == ene_stem and cid in ene_sprites:
                ene_main_sid = cid
                break
        if ene_main_sid is None and ene_sprites:
            ene_main_sid = max(ene_sprites.keys(), key=lambda k: ene_sprites[k][0])

        raw_ene_main_body = None
        for c, b in ene_tags:
            if c not in DEFINITION_TAGS or c in (14,):
                continue
            old_id = struct.unpack("<H", b[:2])[0]
            new_id = old_id + ene_offset
            if c == 39:
                sfc = struct.unpack("<H", b[2:4])[0]
                sub_chunks = []
                for sc, sb in parse_tags(b, 4):
                    if sc in (12, 14, 15, 18, 19, 45):
                        continue
                    if sc == 26 and (sb[0] & 0x02):
                        ref_id = struct.unpack("<H", sb[3:5])[0] + ene_offset
                        sb = sb[:3] + struct.pack("<H", ref_id) + sb[5:]
                    elif sc == 70:
                        _, _, _, ref_cid, _, cpos = parse_place3_info(sb)
                        if ref_cid is not None and cpos is not None:
                            sb = sb[:cpos] + struct.pack("<H", ref_cid + ene_offset) + sb[cpos + 2 :]
                        sb = optimize_place3_for_mobile_gpu(sb)
                    sub_chunks.append(encode_tag(sc, sb))
                remapped_b = struct.pack("<HH", new_id, sfc) + b"".join(sub_chunks)
                if old_id == ene_main_sid:
                    raw_ene_main_body = remapped_b
                else:
                    out_tags.append(encode_tag(39, remapped_b))
            else:
                out_tags.append(encode_tag(c, struct.pack("<H", new_id) + b[2:]))

        base_cid = 800 + unique_idx * 10
        e_standby_body, _ = build_variant_sprite(raw_ene_main_body, base_cid + 0, "standby", loop_self=True)
        e_attack_body, e_atk_dur = build_variant_sprite(raw_ene_main_body, base_cid + 1, "attack_01", loop_self=False)
        e_hit_body, _ = build_variant_sprite(raw_ene_main_body, base_cid + 2, "hit", loop_self=False)
        e_dead_body, _ = build_variant_sprite(raw_ene_main_body, base_cid + 3, "dead", loop_self=False)

        for vb in (e_standby_body, e_attack_body, e_hit_body, e_dead_body):
            out_tags.append(encode_tag(39, vb))

        unique_enemy_meta[ep] = (base_cid, base_cid + 1, base_cid + 2, base_cid + 3, max(22, e_atk_dur))
        unique_idx += 1

    # Optional Mission Backdrop SWF (placed at BG_DEPTH = 1 on Frame 1, never removed!)
    BG_DEPTH = 1
    bg_def_tags, bg_cid, bg_w, bg_h = load_mission_bg_defs(bg_swf_path, id_offset=45000)
    out_tags.extend(bg_def_tags)

    # Per-slot enemy wrapper sprites (850 + idx): placed ONCE on Root Frame 1 with instance name "e0", "e1", "e2"
    # Root timeline NEVER places/removes enemy depths again, so forward GotoFrame NEVER mutates other enemies!
    PLAYER_DEPTH = 6
    enemy_slots = []
    for idx, ep in enumerate(enemy_paths):
        sb_cid, atk_cid, hit_cid, dead_cid, atk_dur = unique_enemy_meta[ep]
        wrapper_cid = 850 + idx
        out_tags.append(encode_tag(39, build_enemy_slot_wrapper(wrapper_cid, sb_cid, atk_cid, hit_cid, dead_cid)))
        tx, ty = slot_positions[idx]
        enemy_slots.append({
            "idx": idx,
            "name": f"e{idx}",
            "depth": idx + 2,
            "actor_depth": 10 + idx,  # temporary clip depth used during this enemy's dash/attack
            "wrapper_cid": wrapper_cid,
            "tx": tx,
            "ty": ty,
            "standby": sb_cid,
            "attack": atk_cid,
            "hit": hit_cid,
            "dead": dead_cid,
            "atk_dur": atk_dur,
        })

    # 2b) Recruited Ally definitions (0 to 2 simultaneous NPC / Friend teammates on the player's side!)
    # Load NPC attack posType metadata from public/game_data/npc.json so ranged/buff jutsus cast in place!
    npc_attack_pos = {}
    npc_json_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "public",
        "game_data",
        "npc.json",
    )
    if os.path.isfile(npc_json_path):
        try:
            with open(npc_json_path, "r", encoding="utf-8") as nf:
                for n_obj in json.load(nf):
                    nid = str(n_obj.get("id", ""))
                    if nid and nid not in npc_attack_pos:
                        pos_map = {}
                        for atk in (n_obj.get("attacks") or []):
                            anim = str(atk.get("animation") or "")
                            pt = str(atk.get("posType") or "melee_1").lower()
                            atk_dmg = float(atk.get("dmg") or 0)
                            effs = atk.get("effects") or []
                            targets_master = any(str(e.get("target") or "").lower() == "master" for e in effs)
                            if anim:
                                if atk_dmg <= 0:
                                    pos_map[anim] = "buff_master" if targets_master else "buff"
                                elif pt.startswith("melee"):
                                    pos_map[anim] = "melee"
                                else:
                                    pos_map[anim] = "ranged"
                        npc_attack_pos[nid] = pos_map
        except Exception:
            pass

    ally_paths = [p.strip() for p in allies_swf_path.split(",") if p.strip() and os.path.isfile(p.strip())][:2]
    ALLY_POS = [(220.0, 168.0), (220.0, 328.0)]
    unique_ally_meta = {}
    unique_ally_idx = 0
    for ap in ally_paths:
        if ap in unique_ally_meta:
            continue
        ally_data = decompress_swf(ap)
        _, _, _, ally_tag_start = parse_header(ally_data)
        ally_tags = parse_tags(ally_data, ally_tag_start)
        ally_offset = 52000 + unique_ally_idx * 3000
        ally_stem = os.path.splitext(os.path.basename(ap))[0].split(" ")[0]
        ally_sprites = {}
        ally_root_candidates = []

        # Build compact sequential ID map so dressed Friend SWFs (whose internal gear CIDs reach ~21000)
        # NEVER overflow the 16-bit SWF CharacterID limit (65535) when remapped!
        ally_id_map = {}
        next_ally_cid = ally_offset
        for c, b in ally_tags:
            if c in DEFINITION_TAGS and c not in (14,) and len(b) >= 2:
                oid = struct.unpack("<H", b[:2])[0]
                if oid not in ally_id_map:
                    ally_id_map[oid] = next_ally_cid
                    next_ally_cid += 1
            if c == 39:
                sid, sfc = struct.unpack("<HH", b[:4])
                ally_sprites[sid] = (sfc, b)
            elif c == 26:
                _, dp, cid, nm = parse_place2_info(b)
                if cid is not None:
                    ally_root_candidates.append((dp, cid, nm))

        ally_main_sid = None
        for _, cid, nm in ally_root_candidates:
            if nm == ally_stem and cid in ally_sprites:
                ally_main_sid = cid
                break
        if ally_main_sid is None and ally_sprites:
            ally_main_sid = max(ally_sprites.keys(), key=lambda k: ally_sprites[k][0])

        raw_ally_main_body = None
        for c, b in ally_tags:
            if c not in DEFINITION_TAGS or c in (14,):
                continue
            old_id = struct.unpack("<H", b[:2])[0]
            new_id = ally_id_map[old_id]
            if c == 39:
                sfc = struct.unpack("<H", b[2:4])[0]
                sub_chunks = []
                for sc, sb in parse_tags(b, 4):
                    if sc in (12, 14, 15, 18, 19, 45):
                        continue
                    if sc == 26 and (sb[0] & 0x02):
                        old_ref = struct.unpack("<H", sb[3:5])[0]
                        ref_id = ally_id_map.get(old_ref, old_ref)
                        sb = sb[:3] + struct.pack("<H", ref_id) + sb[5:]
                    elif sc == 70:
                        _, _, _, ref_cid, _, cpos = parse_place3_info(sb)
                        if ref_cid is not None and cpos is not None:
                            mapped_ref = ally_id_map.get(ref_cid, ref_cid)
                            sb = sb[:cpos] + struct.pack("<H", mapped_ref) + sb[cpos + 2 :]
                        sb = optimize_place3_for_mobile_gpu(sb)
                    sub_chunks.append(encode_tag(sc, sb))
                remapped_b = struct.pack("<HH", new_id, sfc) + b"".join(sub_chunks)
                if old_id == ally_main_sid:
                    raw_ally_main_body = remapped_b
                else:
                    out_tags.append(encode_tag(39, remapped_b))
            else:
                out_tags.append(encode_tag(c, struct.pack("<H", new_id) + b[2:]))

        if raw_ally_main_body is None:
            continue

        # Reverse map for looking up original sprite frame counts (e.g. effectMc duration)
        ally_rev_map = {v: k for k, v in ally_id_map.items()}

        # Discover ALL authentic attack labels + standalone buff effectMc sprites inside this NPC SWF
        found_labels = set()
        label_effect_cid = {}
        cur_lbl = ""
        for sc, sb_b in parse_tags(raw_ally_main_body, 4):
            if sc == 43:
                cur_lbl = sb_b.split(b"\x00")[0].decode("utf-8", errors="ignore").strip()
                if cur_lbl:
                    found_labels.add(cur_lbl)
            elif cur_lbl.startswith("attack_"):
                if sc == 26:
                    _, _, r_cid, r_nm = parse_place2_info(sb_b)
                    if r_cid is not None and r_nm and "effect" in r_nm.lower():
                        label_effect_cid[cur_lbl] = r_cid
                elif sc == 70:
                    _, _, _, r_cid, r_nm, _ = parse_place3_info(sb_b)
                    if r_cid is not None and r_nm and "effect" in r_nm.lower():
                        label_effect_cid[cur_lbl] = r_cid

        atk_labels = [f"attack_0{k}" for k in range(1, 9) if f"attack_0{k}" in found_labels]
        if not atk_labels:
            atk_labels = ["attack_01"]

        a_base_cid = 860 + unique_ally_idx * 10
        a_standby_body, _ = build_variant_sprite(raw_ally_main_body, a_base_cid + 0, "standby", loop_self=True)
        a_hit_body, _ = build_variant_sprite(raw_ally_main_body, a_base_cid + 2, "hit", loop_self=False)
        a_dead_body, _ = build_variant_sprite(raw_ally_main_body, a_base_cid + 3, "dead", loop_self=False)

        atk_variants = []  # list of (label, cid, dur, cast_mode, effect_cid)
        pos_map = npc_attack_pos.get(ally_stem, {})
        for k_idx, atk_lbl in enumerate(atk_labels[:8]):
            atk_cid = 900 + unique_ally_idx * 10 + k_idx
            c_mode = pos_map.get(atk_lbl, "melee")
            eff_cid = label_effect_cid.get(atk_lbl, 0)
            strip_set = {eff_cid} if (c_mode == "buff_master" and eff_cid > 0) else None
            atk_body, atk_dur = build_variant_sprite(
                raw_ally_main_body, atk_cid, atk_lbl, loop_self=False, strip_cids=strip_set
            )
            out_tags.append(encode_tag(39, atk_body))
            final_dur = max(22, atk_dur)
            if c_mode == "buff_master" and eff_cid > 0:
                orig_eff_sid = ally_rev_map.get(eff_cid, 0)
                eff_fc = ally_sprites.get(orig_eff_sid, (0, b""))[0]
                if eff_fc > 0:
                    # Play standalone buff effectMc for its exact native duration (no extra loop!)
                    final_dur = max(18, min(final_dur, eff_fc))
            atk_variants.append((atk_lbl, atk_cid, final_dur, c_mode, eff_cid))

        first_atk_cid = atk_variants[0][1]
        for vb in (a_standby_body, a_hit_body, a_dead_body):
            out_tags.append(encode_tag(39, vb))

        unique_ally_meta[ap] = (a_base_cid, first_atk_cid, a_base_cid + 2, a_base_cid + 3, atk_variants)
        unique_ally_idx += 1

    ally_slots = []
    for idx, ap in enumerate(ally_paths):
        if ap not in unique_ally_meta:
            continue
        sb_cid, atk_cid, hit_cid, dead_cid, atk_variants = unique_ally_meta[ap]
        wrapper_cid = 890 + idx
        out_tags.append(encode_tag(39, build_enemy_slot_wrapper(wrapper_cid, sb_cid, atk_cid, hit_cid, dead_cid)))
        ax, ay = ALLY_POS[idx]
        ally_slots.append({
            "idx": idx,
            "name": f"a{idx}",
            "depth": 7 + idx,        # persistent ally wrapper depths (7, 8)
            "actor_depth": 14 + idx, # temporary clip depth during ally dash/attack/cast (14, 15)
            "vfx_depth": 16 + idx,   # temporary clip depth for standalone buff aura over Player (16, 17)
            "wrapper_cid": wrapper_cid,
            "tx": ax,
            "ty": ay,
            "standby": sb_cid,
            "attack": atk_cid,
            "hit": hit_cid,
            "dead": dead_cid,
            "atk_variants": atk_variants,
        })

    # Load skill cast mode (melee / ranged / self) from public/game_data/skills.json
    skill_cast_mode = {}
    skills_json_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "public",
        "game_data",
        "skills.json",
    )
    if os.path.isfile(skills_json_path):
        try:
            with open(skills_json_path, "r", encoding="utf-8") as sf:
                for sk_obj in json.load(sf):
                    sk_id_key = str(sk_obj.get("id", ""))
                    hit_pos = str(sk_obj.get("attack_hit_position") or "").lower()
                    sk_target = str(sk_obj.get("target") or "").lower()
                    if sk_target == "self":
                        skill_cast_mode[sk_id_key] = "self"
                    elif hit_pos.startswith("meele") or hit_pos.startswith("melee"):
                        skill_cast_mode[sk_id_key] = "melee"
                    else:
                        # Projectile / ranged skills (range_1, range_2, startpos offensive like Fireball & Water Burst)
                        skill_cast_mode[sk_id_key] = "ranged"
        except Exception:
            pass

    # 3) Equipped Skills (up to 6 skills, dressed with player equipment!)
    skill_ids = [s.strip() for s in skills_csv.split(",") if s.strip()][:8]
    skill_entries = []  # (seq_key, skill_sid, skill_fc, cast_mode, cast_offset_x)
    for idx, sk_id in enumerate(skill_ids):
        sk_file = os.path.join(skills_dir, sk_id if sk_id.endswith(".swf") else f"{sk_id}.swf")
        if not os.path.isfile(sk_file):
            sk_file = os.path.join(skills_dir, "skill_01.swf")
        if not os.path.isfile(sk_file):
            continue
        s_defs, s_main_sid, s_fc = load_dressed_skill_defs(sk_file, 30000 + idx * 1500, parts_by_name)
        out_tags.extend(s_defs)
        if s_main_sid is not None:
            clean_key = sk_id.replace(".swf", "")
            default_mode = "melee" if clean_key in ("skill_01", "skill_12") else "ranged"
            c_mode = skill_cast_mode.get(clean_key, default_mode)
            c_off = measure_skill_reach_px(sk_file) if c_mode == "ranged" else 68.0
            skill_entries.append((clean_key, s_main_sid, max(20, s_fc), c_mode, c_off))

    # 3b) Recruited Friend Equipped Skills (up to 6 skills per Friend, compiled cleanly into 58000..65000!)
    ally_skills_per_slot = [s.strip() for s in ally_skills_csv.split(",")] if ally_skills_csv else []
    ally_skill_entries = {}  # ally_idx -> list of (clean_key, s_main_sid, s_fc, c_mode, c_off)
    loaded_friend_skills = {}  # clean_key -> (s_main_sid, s_fc, c_mode, c_off)
    friend_skill_next_offset = 58000
    for al in ally_slots:
        ai = al["idx"]
        spec = ally_skills_per_slot[ai] if ai < len(ally_skills_per_slot) else ""
        if not spec or spec == "none":
            continue
        f_sk_ids = [s.strip() for s in spec.split("+") if s.strip()][:6]
        slot_list = []
        for sk_id in f_sk_ids:
            clean_key = sk_id.replace(".swf", "")
            # Reuse already-compiled player skill if identical, or compile into 58000+ range!
            existing_player = next((e for e in skill_entries if e[0] == clean_key), None)
            if existing_player:
                slot_list.append(existing_player)
                continue
            if clean_key in loaded_friend_skills:
                s_sid, s_fc, c_mode, c_off = loaded_friend_skills[clean_key]
                slot_list.append((clean_key, s_sid, s_fc, c_mode, c_off))
                continue
            if friend_skill_next_offset > 64200:
                continue
            sk_file = os.path.join(skills_dir, sk_id if sk_id.endswith(".swf") else f"{sk_id}.swf")
            if not os.path.isfile(sk_file):
                continue
            s_defs, s_main_sid, s_fc = load_dressed_skill_defs(sk_file, friend_skill_next_offset, parts_by_name)
            friend_skill_next_offset += 650
            out_tags.extend(s_defs)
            if s_main_sid is not None:
                default_mode = "melee" if clean_key in ("skill_01", "skill_12") else "ranged"
                c_mode = skill_cast_mode.get(clean_key, default_mode)
                c_off = measure_skill_reach_px(sk_file) if c_mode == "ranged" else 68.0
                loaded_friend_skills[clean_key] = (s_main_sid, max(20, s_fc), c_mode, c_off)
                slot_list.append((clean_key, s_main_sid, max(20, s_fc), c_mode, c_off))
        if slot_list:
            ally_skill_entries[ai] = slot_list

    # 4) Plan Root Timeline Frame Segments
    # Frame 1: Initial Battle Setup (clears all depths, places ALL enemies in standby)
    # Frame 2: Player-only Reset (clears Depth 5 ONLY so dead enemies stay dead & alive enemies stay idle!)
    # Frame 3: Forward-step placement of 700 (Player_Standby) on Depth 5 + poll
    # Frames 4..26: Idle loop (polls __pollCmd every frame, loops F26 -> F4)
    IDLE_FRAMES = 26
    RESET_PLAYER_FRAME = 2
    DASH_IN_FRAMES = 10
    DASH_OUT_FRAMES = 9
    cur_frame = IDLE_FRAMES + 1

    sequences = []
    cmd_to_frame = {}

    def register_seq(
        name: str,
        kind: str,  # "player_atk" | "player_skill" | "player_charge" | "player_win" | "enemy_atk" | "ally_atk"
        act_duration: int,
        hit_offset: int,
        slot_idx: int = 0,
        skill_cid: int = 0,
        cast_mode: str = "melee",  # "melee" | "ranged" | "self"
        cast_offset_x: float = 68.0,
        is_kill: bool = False,
        ally_idx: int = 0,
        effect_cid: int = 0,
    ):
        nonlocal cur_frame
        has_dash = (
            kind in ("player_atk", "enemy_atk")
            or (kind == "player_skill" and cast_mode in ("melee", "ranged"))
            or (kind == "ally_atk" and cast_mode in ("melee", "ranged"))
        )
        dash_in = DASH_IN_FRAMES if has_dash else 0
        # On enemy_atk_kill (player dies), battle ends so no dash-out needed
        end_stop = (kind == "player_win") or (kind == "enemy_atk" and is_kill)
        dash_out = DASH_OUT_FRAMES if (has_dash and not end_stop) else 0
        total_dur = dash_in + act_duration + dash_out

        act_start = cur_frame + dash_in
        act_end = act_start + act_duration - 1
        end_frame = cur_frame + total_dur - 1

        cmd_to_frame[name] = cur_frame
        sequences.append({
            "name": name,
            "kind": kind,
            "start": cur_frame,
            "dash_in": dash_in,
            "dash_out": dash_out,
            "act_start": act_start,
            "act_end": act_end,
            "end_frame": end_frame,
            "hit_frame": act_start + max(1, min(act_duration - 2, hit_offset)),
            "slot_idx": slot_idx,
            "ally_idx": ally_idx,
            "skill_cid": skill_cid,
            "effect_cid": effect_cid,
            "cast_mode": cast_mode,
            "cast_offset_x": cast_offset_x,
            "is_kill": is_kill,
            "end_stop": end_stop,
        })
        cur_frame += total_dur

    p_atk_len = max(22, p_atk_dur)
    p_chg_len = max(22, p_chg_dur)
    p_item_len = max(20, p_item_dur)

    register_seq("player_charge", "player_charge", p_chg_len, 10, cast_mode="self")
    register_seq("player_item", "player_item", p_item_len, max(8, int(p_item_len * 0.55)), cast_mode="self")
    register_seq("player_win", "player_win", 20, 2, cast_mode="self")

    for sl in enemy_slots:
        t = sl["idx"]
        register_seq(f"p_atk_t{t}", "player_atk", p_atk_len, 12, slot_idx=t, cast_mode="melee", is_kill=False)
        register_seq(f"p_atk_t{t}_kill", "player_atk", p_atk_len, 12, slot_idx=t, cast_mode="melee", is_kill=True)
        register_seq(f"e_atk_s{t}", "enemy_atk", sl["atk_dur"], 12, slot_idx=t, cast_mode="melee", is_kill=False)
        register_seq(f"e_atk_s{t}_kill", "enemy_atk", sl["atk_dur"], 12, slot_idx=t, cast_mode="melee", is_kill=True)

        for sk_key, sk_sid, sk_fc, c_mode, c_off in skill_entries:
            hit_off = max(10, int(sk_fc * 0.58))
            register_seq(
                f"skill_{sk_key}_t{t}", "player_skill", sk_fc, hit_off,
                slot_idx=t, skill_cid=sk_sid, cast_mode=c_mode, cast_offset_x=c_off, is_kill=False
            )
            register_seq(
                f"skill_{sk_key}_t{t}_kill", "player_skill", sk_fc, hit_off,
                slot_idx=t, skill_cid=sk_sid, cast_mode=c_mode, cast_offset_x=c_off, is_kill=True
            )

        for al in ally_slots:
            ai = al["idx"]
            for v_idx, (atk_lbl, atk_cid, atk_dur, c_mode, eff_cid) in enumerate(al["atk_variants"]):
                hit_off = max(10, int(atk_dur * 0.55))
                register_seq(
                    f"a{ai}_{atk_lbl}_t{t}", "ally_atk", atk_dur, hit_off,
                    slot_idx=t, skill_cid=atk_cid, cast_mode=c_mode, is_kill=False, ally_idx=ai, effect_cid=eff_cid
                )
                register_seq(
                    f"a{ai}_{atk_lbl}_t{t}_kill", "ally_atk", atk_dur, hit_off,
                    slot_idx=t, skill_cid=atk_cid, cast_mode=c_mode, is_kill=True, ally_idx=ai, effect_cid=eff_cid
                )
                if v_idx == 0:
                    cmd_to_frame[f"a{ai}_atk_t{t}"] = cmd_to_frame[f"a{ai}_{atk_lbl}_t{t}"]
                    cmd_to_frame[f"a{ai}_atk_t{t}_kill"] = cmd_to_frame[f"a{ai}_{atk_lbl}_t{t}_kill"]

            for f_key, f_sid, f_fc, f_mode, f_off in ally_skill_entries.get(ai, []):
                f_hit = max(10, int(f_fc * 0.58))
                register_seq(
                    f"a{ai}_skill_{f_key}_t{t}", "ally_atk", f_fc, f_hit,
                    slot_idx=t, skill_cid=f_sid, cast_mode=f_mode, cast_offset_x=f_off, is_kill=False, ally_idx=ai
                )
                register_seq(
                    f"a{ai}_skill_{f_key}_t{t}_kill", "ally_atk", f_fc, f_hit,
                    slot_idx=t, skill_cid=f_sid, cast_mode=f_mode, cast_offset_x=f_off, is_kill=True, ally_idx=ai
                )

    total_root_frames = cur_frame - 1

    # Emit Idle Frames (1 .. IDLE_FRAMES)
    poll_normal_bc = avm1_poll_and_dispatch(cmd_to_frame, loop_target_frame=0)
    poll_loop_bc = avm1_poll_and_dispatch(cmd_to_frame, loop_target_frame=4)

    for f in range(1, IDLE_FRAMES + 1):
        if f == 1:
            # Place Mission Background ONCE at BG_DEPTH = 1 (cover-scaled to 760x360)
            if bg_cid is not None:
                bg_sx = ARENA_W / float(bg_w)
                bg_sy = ARENA_H / float(bg_h)
                bg_scale = max(bg_sx, bg_sy)
                bg_tx = (ARENA_W - bg_w * bg_scale) / 2.0
                bg_ty = (ARENA_H - bg_h * bg_scale) / 2.0
                out_tags.append(
                    encode_place_object2(
                        BG_DEPTH, bg_cid, bg_tx, bg_ty,
                        bg_scale, bg_scale, move=False, name="bg"
                    )
                )
            # Initial boot: place ALL enemy wrapper clips ONCE with names "e0", "e1", "e2"
            for sl in enemy_slots:
                out_tags.append(
                    encode_place_object2(
                        sl["depth"], sl["wrapper_cid"], sl["tx"], sl["ty"],
                        CHAR_SCALE, CHAR_SCALE, move=False, name=sl["name"]
                    )
                )
            # Initial boot: place ALL recruited ally wrapper clips ONCE with names "a0", "a1" (facing right!)
            for al in ally_slots:
                out_tags.append(
                    encode_place_object2(
                        al["depth"], al["wrapper_cid"], al["tx"], al["ty"],
                        -CHAR_SCALE, CHAR_SCALE, move=False, name=al["name"]
                    )
                )
            out_tags.append(encode_tag(28, struct.pack("<H", PLAYER_DEPTH)))
        elif f == 2:
            # Player-only reset frame (clears PLAYER_DEPTH & temporary actor/vfx depths so Frame 3 forward-steps 700!)
            out_tags.append(encode_tag(28, struct.pack("<H", PLAYER_DEPTH)))
            for sl in enemy_slots:
                out_tags.append(encode_tag(28, struct.pack("<H", sl["actor_depth"])))
            for al in ally_slots:
                out_tags.append(encode_tag(28, struct.pack("<H", al["actor_depth"])))
                out_tags.append(encode_tag(28, struct.pack("<H", al["vfx_depth"])))
        elif f == 3:
            # Forward-step placement guarantees 700 (Player_Standby) Frame 1 DoAction (gotoAndPlay(10)) ALWAYS executes!
            out_tags.append(encode_place_object2(PLAYER_DEPTH, 700, PLAYER_TX, PLAYER_TY, -CHAR_SCALE, CHAR_SCALE, move=False))
            out_tags.append(encode_tag(12, poll_normal_bc))
        else:
            out_tags.append(encode_tag(12, poll_loop_bc if f == IDLE_FRAMES else poll_normal_bc))
        out_tags.append(encode_tag(1, b""))

    # Emit Sequence Frames (ONLY touch Player Depth 5 on display list; control Enemies purely via AVM1 DoAction!)
    for seq in sequences:
        kind = seq["kind"]
        sl = enemy_slots[seq["slot_idx"]]
        e_name = sl["name"]
        e_tx, e_ty = sl["tx"], sl["ty"]
        # Use exact auto-measured projectile reach per skill, or 68px melee standoff
        cast_offset_x = float(seq.get("cast_offset_x", 68.0))
        p_melee_tx = e_tx - cast_offset_x
        p_melee_ty = e_ty

        start_f = seq["start"]
        dash_in = seq["dash_in"]
        dash_out = seq["dash_out"]
        act_start = seq["act_start"]
        act_end = seq["act_end"]
        end_f = seq["end_frame"]

        for f in range(start_f, end_f + 1):
            # Guard: at the very first frame of ANY sequence, ensure all enemy & ally actor depths are cleanly removed
            if f == start_f:
                for sl_guard in enemy_slots:
                    out_tags.append(encode_tag(28, struct.pack("<H", sl_guard["actor_depth"])))
                for al_guard in ally_slots:
                    out_tags.append(encode_tag(28, struct.pack("<H", al_guard["actor_depth"])))
                    out_tags.append(encode_tag(28, struct.pack("<H", al_guard["vfx_depth"])))

            # --- Player Win Pose ---
            if kind == "player_win":
                if f == start_f:
                    out_tags.append(encode_tag(28, struct.pack("<H", PLAYER_DEPTH)))
                    out_tags.append(encode_place_object2(PLAYER_DEPTH, 704, PLAYER_TX, PLAYER_TY, -CHAR_SCALE, CHAR_SCALE, move=False))
                if f == end_f:
                    out_tags.append(encode_tag(12, avm1_notify_js("__onDone", avm1_stop())))
                out_tags.append(encode_tag(1, b""))
                continue

            # --- Player Charge / Player Item Scroll ---
            if kind in ("player_charge", "player_item"):
                if f == start_f:
                    out_tags.append(encode_tag(28, struct.pack("<H", PLAYER_DEPTH)))
                    p_cid = 707 if kind == "player_item" else 702
                    out_tags.append(encode_place_object2(PLAYER_DEPTH, p_cid, PLAYER_TX, PLAYER_TY, -CHAR_SCALE, CHAR_SCALE, move=False))
                if f == seq["hit_frame"]:
                    out_tags.append(encode_tag(12, avm1_notify_js("__onHit")))
                if f == end_f:
                    out_tags.append(encode_tag(12, avm1_notify_js("__onDone", avm1_goto_and_play(RESET_PLAYER_FRAME))))
                out_tags.append(encode_tag(1, b""))
                continue

            # --- Player Basic Attack / Player Jutsu ---
            if kind in ("player_atk", "player_skill"):
                if dash_in > 0 and start_f <= f < act_start:
                    step = f - start_f
                    t = (step + 1) / float(dash_in)
                    # Smooth Ease-Out Cubic ninja sprint (explosive launch, crisp brake at target!)
                    e = 1.0 - (1.0 - t) ** 3
                    tx = PLAYER_TX + (p_melee_tx - PLAYER_TX) * e
                    ty = PLAYER_TY + (p_melee_ty - PLAYER_TY) * e
                    if f == start_f:
                        out_tags.append(encode_tag(28, struct.pack("<H", PLAYER_DEPTH)))
                        out_tags.append(encode_place_object2(PLAYER_DEPTH, 706, tx, ty, -CHAR_SCALE, CHAR_SCALE, move=False))
                    else:
                        out_tags.append(encode_move_object2(PLAYER_DEPTH, tx, ty, -CHAR_SCALE, CHAR_SCALE))

                if f == act_start:
                    out_tags.append(encode_tag(28, struct.pack("<H", PLAYER_DEPTH)))
                    p_cid = 701 if kind == "player_atk" else seq["skill_cid"]
                    cast_tx = p_melee_tx if dash_in > 0 else PLAYER_TX
                    cast_ty = p_melee_ty if dash_in > 0 else PLAYER_TY
                    out_tags.append(encode_place_object2(PLAYER_DEPTH, p_cid, cast_tx, cast_ty, -CHAR_SCALE, CHAR_SCALE, move=False))

                if f == seq["hit_frame"]:
                    if kind == "player_skill" and seq["cast_mode"] == "self":
                        # Self-buff skill: NEVER trigger enemy hit animation!
                        out_tags.append(encode_tag(12, avm1_notify_js("__onHit")))
                    else:
                        # Frame 3->4 = forward-stepped hit, Frame 8->9 = forward-stepped dead!
                        target_frame = 8 if seq["is_kill"] else 3
                        bc = avm1_clip_goto_play_raw(e_name, target_frame) + avm1_notify_js("__onHit")
                        out_tags.append(encode_tag(12, bc))

                # Auto-restore enemy to Frame 6->7 (fresh standby idle) 16 frames after hit so stunned/restricted enemies NEVER lose idle animation!
                hit_recover_f = min(end_f, seq["hit_frame"] + 16)
                if f == hit_recover_f and f < end_f and not seq["is_kill"] and not (kind == "player_skill" and seq["cast_mode"] == "self"):
                    out_tags.append(encode_tag(12, avm1_clip_goto_play_raw(e_name, 6) + b"\x00"))

                if dash_out > 0 and act_end < f <= end_f:
                    step = f - (act_end + 1)
                    t = (step + 1) / float(dash_out)
                    # Smooth Ease-In-Out Cubic + subtle 14px airborne shinobi backstep arc!
                    e = 3.0 * t * t - 2.0 * t * t * t
                    arc_y = -math.sin(math.pi * t) * 14.0
                    tx = p_melee_tx + (PLAYER_TX - p_melee_tx) * e
                    ty = p_melee_ty + (PLAYER_TY - p_melee_ty) * e + arc_y
                    if step == 0:
                        out_tags.append(encode_tag(28, struct.pack("<H", PLAYER_DEPTH)))
                        out_tags.append(encode_place_object2(PLAYER_DEPTH, 706, tx, ty, -CHAR_SCALE, CHAR_SCALE, move=False))
                    elif f == end_f:
                        # Once player reaches home slot, immediately restore Standby pose (700)
                        out_tags.append(encode_tag(28, struct.pack("<H", PLAYER_DEPTH)))
                        out_tags.append(encode_place_object2(PLAYER_DEPTH, 700, PLAYER_TX, PLAYER_TY, -CHAR_SCALE, CHAR_SCALE, move=False))
                    else:
                        out_tags.append(encode_move_object2(PLAYER_DEPTH, tx, ty, -CHAR_SCALE, CHAR_SCALE))

                if f == end_f:
                    is_self_skill = kind == "player_skill" and seq["cast_mode"] == "self"
                    prefix = b"" if (seq["is_kill"] or is_self_skill) else avm1_clip_goto_play_raw(e_name, 6)
                    out_tags.append(encode_tag(12, prefix + avm1_notify_js("__onDone", avm1_goto_and_play(RESET_PLAYER_FRAME))))

                out_tags.append(encode_tag(1, b""))
                continue

            # --- Enemy Attack ---
            # The persistent wrapper (depth sl["depth"]) is NEVER moved: it is hidden (wrapper frame 5) while a
            # temporary actor clip on sl["actor_depth"] performs dash-in / attack / dash-out, exactly like the player.
            # At the end the actor is removed and the wrapper is shown again in standby at its original slot.
            if kind == "enemy_atk":
                frame_bc = bytearray()
                a_depth = sl["actor_depth"]

                if f == start_f:
                    frame_bc.extend(avm1_clip_goto_stop_raw(e_name, 5))  # hide persistent wrapper
                    # Force player into standby pose (700) at home position so they don't show run or previous pose
                    out_tags.append(encode_tag(28, struct.pack("<H", PLAYER_DEPTH)))
                    out_tags.append(encode_place_object2(PLAYER_DEPTH, 700, PLAYER_TX, PLAYER_TY, -CHAR_SCALE, CHAR_SCALE, move=False))

                if dash_in > 0 and start_f <= f < act_start:
                    step = f - start_f
                    t = (step + 1) / float(dash_in)
                    e = 1.0 - (1.0 - t) ** 3
                    tx = e_tx + (ENEMY_MELEE_TX - e_tx) * e
                    ty = e_ty + (PLAYER_TY - e_ty) * e
                    if f == start_f:
                        out_tags.append(encode_tag(28, struct.pack("<H", a_depth)))
                        out_tags.append(encode_place_object2(a_depth, sl["standby"], tx, ty, CHAR_SCALE, CHAR_SCALE, move=False))
                    else:
                        out_tags.append(encode_move_object2(a_depth, tx, ty, CHAR_SCALE, CHAR_SCALE))

                if f == act_start:
                    out_tags.append(encode_tag(28, struct.pack("<H", a_depth)))
                    out_tags.append(encode_place_object2(a_depth, sl["attack"], ENEMY_MELEE_TX, PLAYER_TY, CHAR_SCALE, CHAR_SCALE, move=False))

                if f == seq["hit_frame"]:
                    out_tags.append(encode_tag(28, struct.pack("<H", PLAYER_DEPTH)))
                    p_hit_cid = 705 if seq["is_kill"] else 703
                    out_tags.append(encode_place_object2(PLAYER_DEPTH, p_hit_cid, PLAYER_TX, PLAYER_TY, -CHAR_SCALE, CHAR_SCALE, move=False))
                    frame_bc.extend(avm1_notify_js("__onHit")[:-1])  # strip trailing 0x00 so we can append cleanly

                if dash_out > 0 and act_end < f < end_f:
                    step = f - (act_end + 1)
                    t = (step + 1) / float(dash_out)
                    e = 3.0 * t * t - 2.0 * t * t * t
                    arc_y = -math.sin(math.pi * t) * 14.0
                    tx = ENEMY_MELEE_TX + (e_tx - ENEMY_MELEE_TX) * e
                    ty = PLAYER_TY + (e_ty - PLAYER_TY) * e + arc_y
                    if step == 0:
                        out_tags.append(encode_tag(28, struct.pack("<H", a_depth)))
                        out_tags.append(encode_place_object2(a_depth, sl["standby"], tx, ty, CHAR_SCALE, CHAR_SCALE, move=False))
                    else:
                        out_tags.append(encode_move_object2(a_depth, tx, ty, CHAR_SCALE, CHAR_SCALE))

                if f == end_f:
                    # ALWAYS remove actor depth and forward-step wrapper into fresh standby (Frame 6->7)
                    out_tags.append(encode_tag(28, struct.pack("<H", a_depth)))
                    frame_bc.extend(avm1_clip_goto_play_raw(e_name, 6))
                    tail_action = avm1_stop() if seq["end_stop"] else avm1_goto_and_play(RESET_PLAYER_FRAME)
                    frame_bc.extend(avm1_notify_js("__onDone", tail_action))
                    out_tags.append(encode_tag(12, bytes(frame_bc)))
                elif frame_bc:
                    frame_bc.append(0x00)
                    out_tags.append(encode_tag(12, bytes(frame_bc)))

                out_tags.append(encode_tag(1, b""))
                continue

            # --- Recruited Ally Attack ---
            if kind == "ally_atk":
                al = ally_slots[seq["ally_idx"]]
                a_name = al["name"]
                a_depth = al["actor_depth"]
                v_depth = al["vfx_depth"]
                al_tx, al_ty = al["tx"], al["ty"]
                al_melee_tx = e_tx - float(seq.get("cast_offset_x", 68.0))
                al_melee_ty = e_ty
                is_master_buff_vfx = (seq["cast_mode"] == "buff_master" and int(seq.get("effect_cid") or 0) > 0)
                frame_bc = bytearray()

                if f == start_f:
                    frame_bc.extend(avm1_clip_goto_stop_raw(a_name, 5))  # hide persistent ally wrapper while casting/attacking

                if dash_in > 0 and start_f <= f < act_start:
                    step = f - start_f
                    t = (step + 1) / float(dash_in)
                    e = 1.0 - (1.0 - t) ** 3
                    tx = al_tx + (al_melee_tx - al_tx) * e
                    ty = al_ty + (al_melee_ty - al_ty) * e
                    if f == start_f:
                        out_tags.append(encode_tag(28, struct.pack("<H", a_depth)))
                        out_tags.append(encode_place_object2(a_depth, al["standby"], tx, ty, -CHAR_SCALE, CHAR_SCALE, move=False))
                    else:
                        out_tags.append(encode_move_object2(a_depth, tx, ty, -CHAR_SCALE, CHAR_SCALE))

                if f == act_start:
                    out_tags.append(encode_tag(28, struct.pack("<H", a_depth)))
                    out_tags.append(encode_tag(28, struct.pack("<H", v_depth)))
                    act_cid = seq["skill_cid"] or al["attack"]
                    if is_master_buff_vfx:
                        # NPC performs its authentic hand-seal casting animation at its OWN slot (al_tx, al_ty),
                        # while standalone buff effectMc plays simultaneously on top of the Player!
                        out_tags.append(
                            encode_place_object2(
                                a_depth, act_cid, al_tx, al_ty, -CHAR_SCALE, CHAR_SCALE, move=False
                            )
                        )
                        out_tags.append(
                            encode_place_object2(
                                v_depth, int(seq["effect_cid"]), PLAYER_TX, PLAYER_TY - 10.0,
                                -CHAR_SCALE, CHAR_SCALE, move=False
                            )
                        )
                    else:
                        if seq["cast_mode"] == "buff_master":
                            cast_tx, cast_ty = PLAYER_TX, PLAYER_TY + 36.0
                        elif dash_in > 0:
                            cast_tx, cast_ty = al_melee_tx, al_melee_ty
                        else:
                            cast_tx, cast_ty = al_tx, al_ty
                        out_tags.append(encode_place_object2(a_depth, act_cid, cast_tx, cast_ty, -CHAR_SCALE, CHAR_SCALE, move=False))

                if f == seq["hit_frame"]:
                    if seq["cast_mode"] not in ("buff", "buff_master"):
                        target_frame = 8 if seq["is_kill"] else 3
                        frame_bc.extend(avm1_clip_goto_play_raw(e_name, target_frame))
                    frame_bc.extend(avm1_notify_js("__onHit")[:-1])

                # Auto-restore enemy to Frame 6->7 (fresh standby idle) 16 frames after hit so stunned/restricted enemies NEVER lose idle animation!
                ally_hit_recover_f = min(end_f, seq["hit_frame"] + 16)
                if f == ally_hit_recover_f and f < end_f and not seq["is_kill"] and seq["cast_mode"] not in ("buff", "buff_master"):
                    frame_bc.extend(avm1_clip_goto_play_raw(e_name, 6))

                if dash_out > 0 and act_end < f < end_f:
                    step = f - (act_end + 1)
                    t = (step + 1) / float(dash_out)
                    e = 3.0 * t * t - 2.0 * t * t * t
                    arc_y = -math.sin(math.pi * t) * 14.0
                    tx = al_melee_tx + (al_tx - al_melee_tx) * e
                    ty = al_melee_ty + (al_ty - al_melee_ty) * e + arc_y
                    if step == 0:
                        out_tags.append(encode_tag(28, struct.pack("<H", a_depth)))
                        out_tags.append(encode_place_object2(a_depth, al["standby"], tx, ty, -CHAR_SCALE, CHAR_SCALE, move=False))
                    else:
                        out_tags.append(encode_move_object2(a_depth, tx, ty, -CHAR_SCALE, CHAR_SCALE))

                if f == end_f:
                    out_tags.append(encode_tag(28, struct.pack("<H", a_depth)))
                    out_tags.append(encode_tag(28, struct.pack("<H", v_depth)))
                    frame_bc.extend(avm1_clip_goto_play_raw(a_name, 6))
                    if not seq["is_kill"] and seq["cast_mode"] not in ("buff", "buff_master"):
                        frame_bc.extend(avm1_clip_goto_play_raw(e_name, 6))
                    frame_bc.extend(avm1_notify_js("__onDone", avm1_goto_and_play(RESET_PLAYER_FRAME)))
                    out_tags.append(encode_tag(12, bytes(frame_bc)))
                elif frame_bc:
                    frame_bc.append(0x00)
                    out_tags.append(encode_tag(12, bytes(frame_bc)))

                out_tags.append(encode_tag(1, b""))
                continue

    out_tags.append(encode_tag(0, b""))

    rect = encode_rect(0, ARENA_W, 0, ARENA_H)
    swf_bytes = build_swf(19, rect, FPS_36_FIXED, total_root_frames, b"".join(out_tags))
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(swf_bytes)


VILLAGE_BUTTON_SCREEN_MAP = {
    61: "missions",      # btn_MissionRoom
    66: "academy",       # btn_Scroll_Academy
    80: "inventory",     # btn_Scroll_Shop
    95: "headquarter",   # btn_Headquarter
    106: "pvp",          # btn_Scroll_Arena
    134: "pvp",          # btn_Arena
    144: "hunting",      # btn_Scroll_Hunting
    160: "talent",       # btn_TalentShop
    166: "petShop",      # btn_Scroll_Pet
    26: "senjutsu",      # btn_Scroll_Senjutsu
    174: "forge",        # btn_Scroll_Battle (Blacksmith / Forge)
    133: "myJutsu",      # btn_Encyclopedia
    151: "stats",        # btn_Recruit
}


def inject_button2_release_action(body: bytes, js_fn_name: str) -> bytes:
    """
    Appends a native AVM1 on(release) BUTTONCONDACTION to an actionless DefineButton2 tag
    so clicking the original Flash building directly triggers ExternalInterface.call(js_fn_name).
    """
    action_offset = len(body) - 3
    cond_block = struct.pack("<H", 0) + bytes([0x08, 0x00]) + avm1_notify_js(js_fn_name)
    return body[:3] + struct.pack("<H", action_offset) + body[5:] + cond_block


def cmd_extract_village_map(ninja_sage_swf: str, output_path: str):
    """Extracts the original Panels.Village (cid=176, 1920x1080) from NinjaSage.swf with native clickable buildings."""
    data = decompress_swf(ninja_sage_swf)
    version, fps_fixed, _, tag_start = parse_header(data)
    tags = parse_tags(data, tag_start)

    out_tags = [encode_tag(69, b"\x20\x00\x00\x00")]
    out_tags.append(encode_tag(9, bytes([0x78, 0xC2, 0xE8])))  # Sky blue fallback BG

    # Collect all definition tags referenced by Panels.Village (cid 1..176)
    for code, body in tags:
        if code in (0, 1, 9, 26, 28, 69, 70, 76, 82):
            continue
        if len(body) >= 2:
            cid = struct.unpack("<H", body[:2])[0]
            if 1 <= cid <= 176:
                if code == 34 and cid in VILLAGE_BUTTON_SCREEN_MAP:
                    screen = VILLAGE_BUTTON_SCREEN_MAP[cid]
                    body = inject_button2_release_action(body, f"__onVillage_{screen}")
                out_tags.append(encode_tag(code, body))

    # Place Panels.Village (cid=176) at origin (0, 0) on the original 1920x1080 stage
    out_tags.append(encode_place_object2(1, 176, 0.0, 0.0, 1.0, 1.0, name="village"))
    out_tags.append(encode_tag(1, b""))
    out_tags.append(encode_tag(0, b""))

    rect = encode_rect(0, 1920, 0, 1080)
    swf_bytes = build_swf(version, rect, fps_fixed, 1, b"".join(out_tags))
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(swf_bytes)


def main():
    if len(sys.argv) < 2:
        sys.exit(1)
    mode = sys.argv[1]
    if mode == "extract-player-base":
        cmd_extract_player_base(sys.argv[2], sys.argv[3])
    elif mode == "extract-village-map":
        cmd_extract_village_map(sys.argv[2], sys.argv[3])
    elif mode == "build-entity":
        cmd_build_entity(
            sys.argv[2],
            sys.argv[3],
            sys.argv[4] if len(sys.argv) > 4 else "standby",
            preview=(len(sys.argv) > 5 and sys.argv[5] == "preview"),
        )
    elif mode == "build-skill":
        cmd_build_skill(sys.argv[2], sys.argv[3])
    elif mode == "build-skill-icons":
        cmd_build_skill_icons(sys.argv[2], sys.argv[3], sys.argv[4])
    elif mode == "build-player-skill":
        cmd_build_player_skill(
            sys.argv[2],
            sys.argv[3],
            sys.argv[4],
            int(sys.argv[5]),
            sys.argv[6],
            sys.argv[7],
            sys.argv[8],
            sys.argv[9],
        )
    elif mode == "build-player":
        cmd_build_player(
            sys.argv[2],
            sys.argv[3],
            sys.argv[4],
            sys.argv[5],
            int(sys.argv[6]),
            sys.argv[7],
            sys.argv[8],
            sys.argv[9],
            sys.argv[10],
            sys.argv[11] if len(sys.argv) > 11 else "",
            sys.argv[12] if len(sys.argv) > 12 else "",
        )
    elif mode == "build-battle":
        cmd_build_battle(
            sys.argv[2],
            sys.argv[3],
            sys.argv[4],
            sys.argv[5],
            sys.argv[6],
            int(sys.argv[7]),
            sys.argv[8],
            sys.argv[9],
            sys.argv[10],
            sys.argv[11],
            sys.argv[12] if len(sys.argv) > 12 else "skill_01",
            sys.argv[13] if len(sys.argv) > 13 else "",
            sys.argv[14] if len(sys.argv) > 14 else "",
            sys.argv[15] if len(sys.argv) > 15 else "",
        )
    else:
        raise ValueError(f"Unknown mode: {mode}")


if __name__ == "__main__":
    main()
