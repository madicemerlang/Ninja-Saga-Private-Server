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
import struct
import zlib
import lzma

DEFINITION_TAGS = {2, 6, 11, 14, 20, 21, 22, 32, 33, 34, 35, 36, 37, 39, 46, 48, 75, 83, 84}

ARENA_W = 760
ARENA_H = 360
PLAYER_TX = 155.0
PLAYER_TY = 280.0
ENEMY_TX = 615.0
ENEMY_TY = 280.0
PLAYER_MELEE_TX = 510.0  # Right in front of Enemy (615) so melee slashes & melee jutsu connect
ENEMY_MELEE_TX = 260.0   # Right in front of Player (155) so enemy melee slashes connect
CHAR_SCALE = 0.52
FPS_36_FIXED = 36 * 256  # 36.0 FPS like Ninja Horizon's fps36

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
    4-frame MovieClip wrapper for an enemy slot:
      Frame 1 = standby, Frame 2 = attack, Frame 3 = hit, Frame 4 = dead.
    Controlled purely via AVM1 SetTarget+GotoFrame so Root timeline jumps NEVER mutate other enemies!
    """
    chunks = []
    for cid in (standby_cid, atk_cid, hit_cid, dead_cid):
        chunks.append(encode_tag(28, struct.pack("<H", 1)))
        chunks.append(encode_place_object2(1, cid, 0.0, 0.0, 1.0, 1.0, move=False))
        chunks.append(encode_tag(12, avm1_stop()))
        chunks.append(encode_tag(1, b""))
    # Frame 5 = hidden (empty). Used while a temporary "actor" clip performs the enemy dash/attack,
    # so the persistent wrapper itself is NEVER moved and can never be left out of its slot.
    chunks.append(encode_tag(28, struct.pack("<H", 1)))
    chunks.append(encode_tag(12, avm1_stop()))
    chunks.append(encode_tag(1, b""))
    chunks.append(encode_tag(0, b""))
    return struct.pack("<HH", wrapper_sid, 5) + b"".join(chunks)


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


def cmd_build_entity(input_path: str, output_path: str, anim: str):
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
        out_tags.append(encode_place_object2(1, main_sid, ENEMY_TX, ENEMY_TY, CHAR_SCALE, CHAR_SCALE))
    out_tags.append(encode_tag(1, b""))
    out_tags.append(encode_tag(0, b""))

    rect = encode_rect(0, ARENA_W, 0, ARENA_H)
    swf_bytes = build_swf(version, rect, FPS_36_FIXED, 1, b"".join(out_tags))
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(swf_bytes)


def load_remapped_item_parts(item_swf_path: str, id_offset: int):
    if not os.path.isfile(item_swf_path):
        return [], {}
    data = decompress_swf(item_swf_path)
    _, _, _, tag_start = parse_header(data)
    tags = parse_tags(data, tag_start)

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
                    if sc == 26 and (sb[0] & 0x02):
                        ref_id = struct.unpack("<H", sb[3:5])[0] + id_offset
                        sb = sb[:3] + struct.pack("<H", ref_id) + sb[5:]
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


def load_player_equipment_tags(items_dir: str, gender: int, hair: str, clothing: str, weapon: str, back: str):
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

    item_files = [
        (face_file, 10000),
        (resolve_item(hair, f"hair_01{g_suffix}.swf"), 12000),
        (resolve_item(clothing, f"set_01{g_suffix}.swf"), 14000),
        (resolve_item(weapon, "wpn_01.swf"), 18000),
        (resolve_item(back, "back_01.swf"), 20000),
    ]

    extra_def_tags = []
    parts_by_name = {}
    for fpath, offset in item_files:
        rtags, pmap = load_remapped_item_parts(fpath, offset)
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

    for c, b in tags:
        if c not in DEFINITION_TAGS or c in (14,):
            continue
        old_id = struct.unpack("<H", b[:2])[0]
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

    out_tags = [encode_tag(69, b"\x20\x00\x00\x00")]
    out_tags.extend(extra_def_tags)
    out_tags.extend(skill_defs)
    if main_skill_sid is not None:
        out_tags.append(encode_place_object2(1, main_skill_sid, PLAYER_TX, PLAYER_TY, -CHAR_SCALE, CHAR_SCALE))
    out_tags.append(encode_tag(1, b""))
    out_tags.append(encode_tag(0, b""))

    rect = encode_rect(0, ARENA_W, 0, ARENA_H)
    swf_bytes = build_swf(19, rect, FPS_36_FIXED, 1, b"".join(out_tags))
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
                # Truncate Sprite #698 at Frame 398 (drops 514 unused seasonal emote frames!)
                sub_chunks = []
                cf = 1
                for sc, sb in parse_tags(b, 4):
                    if sc in (0, 12, 14, 15, 18, 19, 45):
                        continue
                    sub_chunks.append(encode_tag(sc, sb))
                    if sc == 1:
                        if cf >= 398:
                            break
                        cf += 1
                sub_chunks.append(encode_tag(0, b""))
                b = struct.pack("<HH", 698, min(cf, 398)) + b"".join(sub_chunks)
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
):
    data = decompress_swf(base_swf_path)
    version, _, _, tag_start = parse_header(data)
    base_tags = parse_tags(data, tag_start)

    extra_def_tags, parts_by_name = load_player_equipment_tags(
        items_dir, gender, hair, clothing, weapon, back
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

    out_tags.append(encode_place_object2(1, 698, PLAYER_TX, PLAYER_TY, -CHAR_SCALE, CHAR_SCALE))
    out_tags.append(encode_tag(1, b""))
    out_tags.append(encode_tag(0, b""))

    rect = encode_rect(0, ARENA_W, 0, ARENA_H)
    swf_bytes = build_swf(version, rect, FPS_36_FIXED, 1, b"".join(out_tags))
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(swf_bytes)


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

    for vb in (p_standby_body, p_attack_body, p_charge_body, p_hit_body, p_win_body, p_dead_body, p_run_body):
        out_tags.append(encode_tag(39, vb))

    # 2) Enemy definitions (1 to 3 simultaneous enemies, deduplicated by SWF path!)
    # Formation positions on the right side of the 760x360 arena
    enemy_paths = [p.strip() for p in enemy_swf_path.split(",") if p.strip()][:3]
    if not enemy_paths:
        raise ValueError("No enemy SWF paths provided")

    FORMATION_POS = {
        1: [(615.0, 280.0)],
        2: [(585.0, 232.0), (645.0, 305.0)],
        3: [(590.0, 215.0), (655.0, 272.0), (580.0, 322.0)],
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

    # Per-slot enemy wrapper sprites (850 + idx): placed ONCE on Root Frame 1 with instance name "e0", "e1", "e2"
    # Root timeline NEVER places/removes enemy depths again, so forward GotoFrame NEVER mutates other enemies!
    PLAYER_DEPTH = 5
    enemy_slots = []
    for idx, ep in enumerate(enemy_paths):
        sb_cid, atk_cid, hit_cid, dead_cid, atk_dur = unique_enemy_meta[ep]
        wrapper_cid = 850 + idx
        out_tags.append(encode_tag(39, build_enemy_slot_wrapper(wrapper_cid, sb_cid, atk_cid, hit_cid, dead_cid)))
        tx, ty = slot_positions[idx]
        enemy_slots.append({
            "idx": idx,
            "name": f"e{idx}",
            "depth": idx + 1,
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

    # Load skill melee/ranged metadata from public/game_data/skills.json
    skill_is_melee = {}
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
                    skill_is_melee[sk_id_key] = hit_pos.startswith("meele") or hit_pos.startswith("melee")
        except Exception:
            pass

    # 3) Equipped Skills (up to 6 skills, dressed with player equipment!)
    skill_ids = [s.strip() for s in skills_csv.split(",") if s.strip()][:6]
    skill_entries = []  # (seq_key, skill_sid, skill_fc, is_melee)
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
            is_melee = skill_is_melee.get(clean_key, clean_key in ("skill_01", "skill_12"))
            skill_entries.append((clean_key, s_main_sid, max(20, s_fc), is_melee))

    # 4) Plan Root Timeline Frame Segments
    # Frame 1: Initial Battle Setup (clears all depths, places ALL enemies in standby)
    # Frame 2: Player-only Reset (clears Depth 5 ONLY so dead enemies stay dead & alive enemies stay idle!)
    # Frame 3: Forward-step placement of 700 (Player_Standby) on Depth 5 + poll
    # Frames 4..26: Idle loop (polls __pollCmd every frame, loops F26 -> F4)
    IDLE_FRAMES = 26
    RESET_PLAYER_FRAME = 2
    DASH_IN_FRAMES = 6
    DASH_OUT_FRAMES = 5
    cur_frame = IDLE_FRAMES + 1

    sequences = []
    cmd_to_frame = {}

    def register_seq(
        name: str,
        kind: str,  # "player_atk" | "player_skill" | "player_charge" | "player_win" | "enemy_atk"
        act_duration: int,
        hit_offset: int,
        slot_idx: int = 0,
        skill_cid: int = 0,
        is_melee: bool = False,
        is_kill: bool = False,
    ):
        nonlocal cur_frame
        has_dash = kind in ("player_atk", "enemy_atk") or (kind == "player_skill" and is_melee)
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
            "skill_cid": skill_cid,
            "is_melee": is_melee,
            "is_kill": is_kill,
            "end_stop": end_stop,
        })
        cur_frame += total_dur

    p_atk_len = max(22, p_atk_dur)
    p_chg_len = max(22, p_chg_dur)

    register_seq("player_charge", "player_charge", p_chg_len, 10)
    register_seq("player_win", "player_win", 20, 2)

    for sl in enemy_slots:
        t = sl["idx"]
        register_seq(f"p_atk_t{t}", "player_atk", p_atk_len, 12, slot_idx=t, is_melee=True, is_kill=False)
        register_seq(f"p_atk_t{t}_kill", "player_atk", p_atk_len, 12, slot_idx=t, is_melee=True, is_kill=True)
        register_seq(f"e_atk_s{t}", "enemy_atk", sl["atk_dur"], 12, slot_idx=t, is_melee=True, is_kill=False)
        register_seq(f"e_atk_s{t}_kill", "enemy_atk", sl["atk_dur"], 12, slot_idx=t, is_melee=True, is_kill=True)

        for sk_key, sk_sid, sk_fc, is_melee in skill_entries:
            hit_off = max(10, int(sk_fc * 0.58))
            register_seq(
                f"skill_{sk_key}_t{t}", "player_skill", sk_fc, hit_off,
                slot_idx=t, skill_cid=sk_sid, is_melee=is_melee, is_kill=False
            )
            register_seq(
                f"skill_{sk_key}_t{t}_kill", "player_skill", sk_fc, hit_off,
                slot_idx=t, skill_cid=sk_sid, is_melee=is_melee, is_kill=True
            )

    total_root_frames = cur_frame - 1

    # Emit Idle Frames (1 .. IDLE_FRAMES)
    poll_normal_bc = avm1_poll_and_dispatch(cmd_to_frame, loop_target_frame=0)
    poll_loop_bc = avm1_poll_and_dispatch(cmd_to_frame, loop_target_frame=4)

    for f in range(1, IDLE_FRAMES + 1):
        if f == 1:
            # Initial boot: place ALL enemy wrapper clips ONCE with names "e0", "e1", "e2"
            for sl in enemy_slots:
                out_tags.append(
                    encode_place_object2(
                        sl["depth"], sl["wrapper_cid"], sl["tx"], sl["ty"],
                        CHAR_SCALE, CHAR_SCALE, move=False, name=sl["name"]
                    )
                )
            out_tags.append(encode_tag(28, struct.pack("<H", PLAYER_DEPTH)))
        elif f == 2:
            # Player-only reset frame (targeted by gotoAndPlay(2) after any action so enemy dead/idle states are preserved!)
            # Also clears any temporary enemy actor clips (they are never left on stage).
            out_tags.append(encode_tag(28, struct.pack("<H", PLAYER_DEPTH)))
            for sl in enemy_slots:
                out_tags.append(encode_tag(28, struct.pack("<H", sl["actor_depth"])))
        elif f == 3:
            # Forward-step placement guarantees 700 (Player_Standby) Frame 1 DoAction always executes!
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
        p_melee_tx = e_tx - 105.0
        p_melee_ty = e_ty

        start_f = seq["start"]
        dash_in = seq["dash_in"]
        dash_out = seq["dash_out"]
        act_start = seq["act_start"]
        act_end = seq["act_end"]
        end_f = seq["end_frame"]

        for f in range(start_f, end_f + 1):
            # Guard: at the very first frame of ANY sequence, ensure all enemy actor depths are cleanly removed
            if f == start_f:
                for sl_guard in enemy_slots:
                    out_tags.append(encode_tag(28, struct.pack("<H", sl_guard["actor_depth"])))

            # --- Player Win Pose ---
            if kind == "player_win":
                if f == start_f:
                    out_tags.append(encode_tag(28, struct.pack("<H", PLAYER_DEPTH)))
                    out_tags.append(encode_place_object2(PLAYER_DEPTH, 704, PLAYER_TX, PLAYER_TY, -CHAR_SCALE, CHAR_SCALE, move=False))
                if f == end_f:
                    out_tags.append(encode_tag(12, avm1_notify_js("__onDone", avm1_stop())))
                out_tags.append(encode_tag(1, b""))
                continue

            # --- Player Charge ---
            if kind == "player_charge":
                if f == start_f:
                    out_tags.append(encode_tag(28, struct.pack("<H", PLAYER_DEPTH)))
                    out_tags.append(encode_place_object2(PLAYER_DEPTH, 702, PLAYER_TX, PLAYER_TY, -CHAR_SCALE, CHAR_SCALE, move=False))
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
                    tx = PLAYER_TX + (p_melee_tx - PLAYER_TX) * t
                    ty = PLAYER_TY + (p_melee_ty - PLAYER_TY) * t
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
                    # Frame 3 = hit, Frame 4 = dead on target EnemySlot wrapper ONLY!
                    target_frame = 4 if seq["is_kill"] else 3
                    bc = avm1_clip_goto_stop_raw(e_name, target_frame) + avm1_notify_js("__onHit")
                    out_tags.append(encode_tag(12, bc))

                if dash_out > 0 and act_end < f <= end_f:
                    step = f - (act_end + 1)
                    t = (step + 1) / float(dash_out)
                    tx = p_melee_tx + (PLAYER_TX - p_melee_tx) * t
                    ty = p_melee_ty + (PLAYER_TY - p_melee_ty) * t
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
                    prefix = b"" if seq["is_kill"] else avm1_clip_goto_stop_raw(e_name, 1)
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
                    tx = e_tx + (ENEMY_MELEE_TX - e_tx) * t
                    ty = e_ty + (PLAYER_TY - e_ty) * t
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
                    tx = ENEMY_MELEE_TX + (e_tx - ENEMY_MELEE_TX) * t
                    ty = PLAYER_TY + (e_ty - PLAYER_TY) * t
                    if step == 0:
                        out_tags.append(encode_tag(28, struct.pack("<H", a_depth)))
                        out_tags.append(encode_place_object2(a_depth, sl["standby"], tx, ty, CHAR_SCALE, CHAR_SCALE, move=False))
                    else:
                        out_tags.append(encode_move_object2(a_depth, tx, ty, CHAR_SCALE, CHAR_SCALE))

                if f == end_f:
                    # ALWAYS remove actor depth and restore wrapper
                    out_tags.append(encode_tag(28, struct.pack("<H", a_depth)))
                    frame_bc.extend(avm1_clip_goto_stop_raw(e_name, 1))  # show wrapper again (standby, home slot)
                    tail_action = avm1_stop() if seq["end_stop"] else avm1_goto_and_play(RESET_PLAYER_FRAME)
                    frame_bc.extend(avm1_notify_js("__onDone", tail_action))
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


def main():
    if len(sys.argv) < 2:
        sys.exit(1)
    mode = sys.argv[1]
    if mode == "extract-player-base":
        cmd_extract_player_base(sys.argv[2], sys.argv[3])
    elif mode == "build-entity":
        cmd_build_entity(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else "standby")
    elif mode == "build-skill":
        cmd_build_skill(sys.argv[2], sys.argv[3])
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
        )
    else:
        raise ValueError(f"Unknown mode: {mode}")


if __name__ == "__main__":
    main()
