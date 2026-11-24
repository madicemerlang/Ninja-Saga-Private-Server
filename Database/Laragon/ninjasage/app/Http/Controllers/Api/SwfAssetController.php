<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Character;
use App\Models\Skill;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class SwfAssetController extends Controller
{
    private const ALLOWED_CATEGORIES = [
        'consumables',
        'enemy',
        'essentials',
        'items',
        'materials',
        'mission',
        'npcs',
        'pets',
        'skills',
        'sounds',
        'swfpanels',
    ];

    public function catalog(): JsonResponse
    {
        $base = $this->basePath();
        $categories = [];
        $totalSwfs = 0;

        foreach (self::ALLOWED_CATEGORIES as $cat) {
            $dir = $base . DIRECTORY_SEPARATOR . $cat;
            $count = 0;
            if (is_dir($dir)) {
                foreach (scandir($dir) ?: [] as $entry) {
                    if ($entry !== '.' && $entry !== '..' && is_file($dir . DIRECTORY_SEPARATOR . $entry)) {
                        $count++;
                    }
                }
            }
            $categories[$cat] = $count;
            $totalSwfs += $count;
        }

        $audioDir = public_path('audio');
        $audioFiles = [];
        if (is_dir($audioDir)) {
            foreach (scandir($audioDir) ?: [] as $entry) {
                if (str_ends_with($entry, '.mp3')) {
                    $audioFiles[] = $entry;
                }
            }
        }

        $gameDataDir = public_path('game_data');
        $gameDataFiles = [];
        if (is_dir($gameDataDir)) {
            foreach (scandir($gameDataDir) ?: [] as $entry) {
                if (str_ends_with($entry, '.json')) {
                    $gameDataFiles[] = $entry;
                }
            }
        }

        return response()->json([
            'status' => 1,
            'total_assets' => $totalSwfs,
            'categories' => $categories,
            'audio' => $audioFiles,
            'game_data' => $gameDataFiles,
        ]);
    }

    public function index(string $category, Request $request): JsonResponse
    {
        if (!in_array($category, self::ALLOWED_CATEGORIES, true)) {
            return response()->json(['error' => 'Invalid SWF category'], 404);
        }

        $dir = $this->basePath() . DIRECTORY_SEPARATOR . $category;
        if (!is_dir($dir)) {
            return response()->json(['error' => 'SWF directory not found', 'path' => $dir], 404);
        }

        $limit = min(max((int) $request->query('limit', 100), 1), 6000);
        $prefix = (string) $request->query('prefix', '');

        $files = [];
        foreach (scandir($dir) ?: [] as $entry) {
            if (!str_ends_with($entry, '.swf')) {
                continue;
            }
            if ($prefix !== '' && !str_starts_with($entry, $prefix)) {
                continue;
            }
            $files[] = $entry;
            if (count($files) >= $limit) {
                break;
            }
        }

        return response()->json([
            'category' => $category,
            'count' => count($files),
            'files' => $files,
        ]);
    }

    public function show(string $category, string $filename, Request $request): BinaryFileResponse|JsonResponse
    {
        if (!in_array($category, self::ALLOWED_CATEGORIES, true)) {
            return response()->json(['error' => 'Invalid SWF category'], 404);
        }

        if (!preg_match('/^[a-zA-Z0-9._-]+\.swf$/', $filename)) {
            return response()->json(['error' => 'Invalid SWF filename'], 400);
        }

        $dir = $this->basePath() . DIRECTORY_SEPARATOR . $category;
        $path = $dir . DIRECTORY_SEPARATOR . $filename;

        if (!is_file($path) && $category === 'skills') {
            $skillId = pathinfo($filename, PATHINFO_FILENAME);
            $swfAlias = Skill::where('skill_id', $skillId)->value('swf');
            $fallbackName = $swfAlias ? ($swfAlias . '.swf') : env('SKILL_DEFAULT_SWF', 'skill_01.swf');
            $fallbackPath = $dir . DIRECTORY_SEPARATOR . $fallbackName;
            if (is_file($fallbackPath)) {
                $path = $fallbackPath;
            }
        }

        if (!is_file($path)) {
            return response()->json(['error' => 'SWF file not found'], 404);
        }

        $rawMode = (bool) $request->query('raw', false);
        $anim = preg_replace('/[^a-zA-Z0-9_]/', '', (string) $request->query('anim', 'standby')) ?: 'standby';
        $stem = pathinfo($path, PATHINFO_FILENAME);

        if (!$rawMode && in_array($category, ['enemy', 'npcs', 'pets'], true)) {
            $isPreview = in_array($category, ['pets', 'enemy'], true);
            $cacheFile = $isPreview ? "{$category}_{$stem}_{$anim}_preview_v4.swf" : "{$category}_{$stem}_{$anim}.swf";
            $cached = $this->compileEntitySwf($path, $cacheFile, $anim, $isPreview);
            if ($cached) {
                $path = $cached;
            }
        } elseif (!$rawMode && $category === 'skills') {
            $cached = $this->compileSkillSwf($path, "skills_{$stem}_clean.swf");
            if ($cached) {
                $path = $cached;
            }
        }

        return response()->file($path, [
            'Content-Type' => 'application/x-shockwave-flash',
            'Cache-Control' => 'no-cache, public',
            'Access-Control-Allow-Origin' => '*',
        ]);
    }

    public function villageMap(): BinaryFileResponse|JsonResponse
    {
        $cacheDir = storage_path('app/swf_cache');
        if (!is_dir($cacheDir)) {
            @mkdir($cacheDir, 0775, true);
        }
        $cachedPath = $cacheDir . DIRECTORY_SEPARATOR . 'village_map_v2.swf';

        if (!is_file($cachedPath)) {
            $ninjaSageSwf = $this->basePath() . DIRECTORY_SEPARATOR . 'NinjaSage.swf';
            $script = base_path('scripts/swf_builder.py');
            if (!is_file($ninjaSageSwf) || !is_file($script)) {
                return response()->json(['error' => 'NinjaSage.swf not found'], 404);
            }
            $cmd = sprintf(
                'python3 %s extract-village-map %s %s 2>&1',
                escapeshellarg($script),
                escapeshellarg($ninjaSageSwf),
                escapeshellarg($cachedPath)
            );
            shell_exec($cmd);
        }

        if (!is_file($cachedPath)) {
            return response()->json(['error' => 'Failed compiling village map SWF'], 500);
        }

        return response()->file($cachedPath, [
            'Content-Type' => 'application/x-shockwave-flash',
            'Cache-Control' => 'public, max-age=86400',
            'Access-Control-Allow-Origin' => '*',
        ]);
    }

    public function iconSheet(string $category, Request $request): BinaryFileResponse|JsonResponse
    {
        if (!in_array($category, ['skills', 'items', 'materials', 'consumables', 'pets'], true)) {
            return response()->json(['error' => 'Invalid icon category'], 404);
        }

        $idsRaw = (string) $request->query('ids', '');
        $ids = array_slice(array_values(array_filter(array_map(
            static fn ($s) => preg_replace('/[^a-zA-Z0-9_-]/', '', trim($s)),
            explode(',', $idsRaw)
        ))), 0, 12);

        if (empty($ids)) {
            return response()->json(['error' => 'No asset IDs provided'], 400);
        }

        $assetDir = $this->basePath() . DIRECTORY_SEPARATOR . $category;
        $script = base_path('scripts/swf_builder.py');
        $cacheDir = storage_path('app/swf_cache');
        if (!is_dir($cacheDir)) {
            @mkdir($cacheDir, 0775, true);
        }

        $csv = implode(',', $ids);
        $hash = substr(md5("{$category}|{$csv}|v10_hd"), 0, 12);
        $cachedPath = $cacheDir . DIRECTORY_SEPARATOR . "icons_{$category}_{$hash}.swf";

        if (!is_file($cachedPath)) {
            $cmd = sprintf(
                'python3 %s build-skill-icons %s %s %s 2>&1',
                escapeshellarg($script),
                escapeshellarg($assetDir),
                escapeshellarg($csv),
                escapeshellarg($cachedPath)
            );
            shell_exec($cmd);
        }

        if (!is_file($cachedPath)) {
            return response()->json(['error' => 'Failed compiling icon sheet SWF'], 500);
        }

        return response()->file($cachedPath, [
            'Content-Type' => 'application/x-shockwave-flash',
            'Cache-Control' => 'public, max-age=86400',
            'Access-Control-Allow-Origin' => '*',
        ]);
    }

    public function player(int $charId, Request $request): BinaryFileResponse|JsonResponse
    {
        $anim = preg_replace('/[^a-zA-Z0-9_]/', '', (string) $request->query('anim', 'standby')) ?: 'standby';
        $char = Character::find($charId);

        $gender = (int) ($char?->gender ?? 0);
        $gSuffix = $gender === 0 ? '_0' : '_1';
        $cleanId = static fn (?string $v): string => preg_replace('/[^a-zA-Z0-9_-]/', '', (string) $v) ?? '';
        $hair = $cleanId($request->query('hair')) ?: (string) ($char?->hair_style ?: "hair_01{$gSuffix}");
        $clothing = $cleanId($request->query('clothing')) ?: (string) ($char?->equipment_clothing ?: "set_01{$gSuffix}");
        $weapon = $cleanId($request->query('weapon')) ?: (string) ($char?->equipment_weapon ?: 'wpn_01');
        $back = $cleanId($request->query('back')) ?: (string) ($char?->equipment_back ?: 'back_01');

        $baseSwf = storage_path('app/swf_base/player_base.swf');
        $script = base_path('scripts/swf_builder.py');
        $itemsDir = $this->basePath() . DIRECTORY_SEPARATOR . 'items';

        if (!is_file($baseSwf)) {
            $ninjaSageSwf = $this->basePath() . DIRECTORY_SEPARATOR . 'NinjaSage.swf';
            if (is_file($ninjaSageSwf) && is_file($script)) {
                $cmd = sprintf(
                    'python3 %s extract-player-base %s %s 2>&1',
                    escapeshellarg($script),
                    escapeshellarg($ninjaSageSwf),
                    escapeshellarg($baseSwf)
                );
                shell_exec($cmd);
            }
        }

        if (!is_file($baseSwf)) {
            return response()->json(['error' => 'player_base.swf could not be initialized'], 500);
        }

        $portraitMode = filter_var($request->query('portrait', false), FILTER_VALIDATE_BOOLEAN);
        $bgName = $cleanId($request->query('bg'));
        $bgPath = '';
        if ($portraitMode) {
            $bgPath = '__portrait__';
        } elseif ($bgName !== '') {
            $candBg = $this->basePath() . DIRECTORY_SEPARATOR . 'mission' . DIRECTORY_SEPARATOR . $bgName . '.swf';
            if (is_file($candBg)) {
                $bgPath = $candBg;
            }
        }

        $hairColor = preg_replace('/[^0-9|]/', '', (string) ($request->query('hair_color') ?: $char?->hair_color ?: '0|0')) ?? '0|0';
        $modeTag = $portraitMode ? 'portrait' : $bgName;
        $equipHash = substr(md5("{$gender}|{$hair}|{$hairColor}|{$clothing}|{$weapon}|{$back}|{$modeTag}|v29"), 0, 12);
        $cacheDir = storage_path('app/swf_cache');
        if (!is_dir($cacheDir)) {
            @mkdir($cacheDir, 0775, true);
        }
        $cachedPath = $cacheDir . DIRECTORY_SEPARATOR . "player_{$charId}_{$anim}_{$equipHash}.swf";

        if (!is_file($cachedPath)) {
            $cmd = sprintf(
                'python3 %s build-player %s %s %s %s %d %s %s %s %s %s %s 2>&1',
                escapeshellarg($script),
                escapeshellarg($baseSwf),
                escapeshellarg($itemsDir),
                escapeshellarg($cachedPath),
                escapeshellarg($anim),
                $gender,
                escapeshellarg($hair),
                escapeshellarg($clothing),
                escapeshellarg($weapon),
                escapeshellarg($back),
                escapeshellarg($bgPath),
                escapeshellarg($hairColor)
            );
            shell_exec($cmd);
        }

        if (!is_file($cachedPath)) {
            return response()->json(['error' => 'Failed compiling player SWF'], 500);
        }

        return response()->file($cachedPath, [
            'Content-Type' => 'application/x-shockwave-flash',
            'Cache-Control' => 'public, max-age=86400',
            'Access-Control-Allow-Origin' => '*',
        ]);
    }

    public function battle(int $charId, string $enemyId, Request $request): BinaryFileResponse|JsonResponse
    {
        $rawList = pathinfo($enemyId, PATHINFO_FILENAME);
        $parts = array_slice(array_filter(array_map(function ($item) {
            return preg_replace('/[^a-zA-Z0-9_-]/', '', trim($item));
        }, explode(',', $rawList))), 0, 3);

        if (empty($parts)) {
            return response()->json(['error' => 'Invalid enemy ID'], 400);
        }

        $baseSwf = storage_path('app/swf_base/player_base.swf');
        $script = base_path('scripts/swf_builder.py');
        $itemsDir = $this->basePath() . DIRECTORY_SEPARATOR . 'items';
        $skillsDir = $this->basePath() . DIRECTORY_SEPARATOR . 'skills';
        $cacheDir = storage_path('app/swf_cache');
        if (!is_dir($cacheDir)) {
            @mkdir($cacheDir, 0775, true);
        }

        $enemyPaths = [];
        foreach ($parts as $ename) {
            // Check if this enemy is an opponent player character (e.g. char_2 or p_2)
            if (preg_match('/^(?:char|p)_?(\d+)$/i', $ename, $m)) {
                $oppCharId = (int) $m[1];
                $oppChar = Character::find($oppCharId);
                $oppGender = (int) ($oppChar?->gender ?? 0);
                $oppGSuffix = $oppGender === 0 ? '_0' : '_1';
                $oppHair = (string) ($oppChar?->hair_style ?: "hair_01{$oppGSuffix}");
                $oppClothing = (string) ($oppChar?->equipment_clothing ?: "set_01{$oppGSuffix}");
                $oppWeapon = (string) ($oppChar?->equipment_weapon ?: 'wpn_01');
                $oppBack = (string) ($oppChar?->equipment_back ?: '');
                $oppHash = substr(md5("{$oppGender}|{$oppHair}|{$oppClothing}|{$oppWeapon}|{$oppBack}"), 0, 10);
                $oppPlayerSwf = $cacheDir . DIRECTORY_SEPARATOR . "player_opp_{$oppCharId}_{$oppHash}.swf";

                if (!is_file($oppPlayerSwf)) {
                    $cmdOpp = sprintf(
                        'python3 %s build-player %s %s %s standby %d %s %s %s %s 2>&1',
                        escapeshellarg($script),
                        escapeshellarg($baseSwf),
                        escapeshellarg($itemsDir),
                        escapeshellarg($oppPlayerSwf),
                        $oppGender,
                        escapeshellarg($oppHair),
                        escapeshellarg($oppClothing),
                        escapeshellarg($oppWeapon),
                        escapeshellarg($oppBack)
                    );
                    shell_exec($cmdOpp);
                }

                if (is_file($oppPlayerSwf)) {
                    $enemyPaths[] = $oppPlayerSwf;
                    continue;
                }
            }

            $ep = $this->basePath() . DIRECTORY_SEPARATOR . 'enemy' . DIRECTORY_SEPARATOR . $ename . '.swf';
            if (!is_file($ep)) {
                $ep = $this->basePath() . DIRECTORY_SEPARATOR . 'enemy' . DIRECTORY_SEPARATOR . 'ene_01.swf';
            }
            if (!is_file($ep)) {
                return response()->json(['error' => 'Enemy SWF not found'], 404);
            }
            $enemyPaths[] = $ep;
        }
        $enemiesKey = implode('_', $parts);
        $enemyPathsCsv = implode(',', $enemyPaths);

        $char = Character::find($charId);
        $gender = (int) ($char?->gender ?? 0);
        $gSuffix = $gender === 0 ? '_0' : '_1';
        $cleanId = static fn (?string $v): string => preg_replace('/[^a-zA-Z0-9_-]/', '', (string) $v) ?? '';
        $hair = $cleanId($request->query('hair')) ?: (string) ($char?->hair_style ?: "hair_01{$gSuffix}");
        $clothing = $cleanId($request->query('clothing')) ?: (string) ($char?->equipment_clothing ?: "set_01{$gSuffix}");
        $weapon = $cleanId($request->query('weapon')) ?: (string) ($char?->equipment_weapon ?: 'wpn_01');
        $back = $cleanId($request->query('back')) ?: (string) ($char?->equipment_back ?: 'back_01');
        $skillsCsv = (string) ($request->query('skills') ?: $char?->equipment_skills ?: 'skill_01');
        $bgName = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) $request->query('bg', ''));
        $bgPath = '';
        if ($bgName !== '') {
            $candidateBg = $this->basePath() . DIRECTORY_SEPARATOR . 'mission' . DIRECTORY_SEPARATOR . $bgName . '.swf';
            if (is_file($candidateBg)) {
                $bgPath = $candidateBg;
            }
        }

        // Resolve optional recruited allies (up to 2 NPC/Friend IDs + 1 equipped Pet SWF, comma-separated)
        $rawAllies = (string) $request->query('allies', '');
        $allyParts = array_slice(array_filter(array_map(function ($item) {
            return preg_replace('/[^a-zA-Z0-9_-]/', '', trim($item));
        }, explode(',', $rawAllies))), 0, 3);

        $allyPaths = [];
        $allySkillsSpecs = [];
        foreach ($allyParts as $aid) {
            if (str_starts_with($aid, 'pet_')) {
                $pp = $this->basePath() . DIRECTORY_SEPARATOR . 'pets' . DIRECTORY_SEPARATOR . $aid . '.swf';
                if (is_file($pp)) {
                    $allyPaths[] = $pp;
                    $allySkillsSpecs[] = 'none';
                    continue;
                }
            }

            if (preg_match('/^(?:friend|char|p)_?(\d+)$/i', $aid, $fm)) {
                $frCharId = (int) $fm[1];
                $frChar = Character::find($frCharId);
                $frGender = (int) ($frChar?->gender ?? 0);
                $frGSuffix = $frGender === 0 ? '_0' : '_1';
                $frHair = (string) ($frChar?->hair_style ?: "hair_01{$frGSuffix}");
                $frClothing = (string) ($frChar?->equipment_clothing ?: "set_01{$frGSuffix}");
                $frWeapon = (string) ($frChar?->equipment_weapon ?: 'wpn_01');
                $frBack = (string) ($frChar?->equipment_back ?: '');
                $frHairColor = (string) ($frChar?->hair_color ?: '0|0');
                $frSkillsRaw = (string) ($frChar?->equipment_skills ?: 'skill_01');
                $frSkillsList = array_slice(array_filter(array_map(function ($s) {
                    return preg_replace('/[^a-zA-Z0-9_-]/', '', trim($s));
                }, explode(',', $frSkillsRaw))), 0, 6);
                $frHash = substr(md5("{$frGender}|{$frHair}|{$frHairColor}|{$frClothing}|{$frWeapon}|{$frBack}"), 0, 10);
                $frPlayerSwf = $cacheDir . DIRECTORY_SEPARATOR . "player_ally_{$frCharId}_{$frHash}.swf";

                if (!is_file($frPlayerSwf)) {
                    $cmdFr = sprintf(
                        'python3 %s build-player %s %s %s standby %d %s %s %s %s %s 2>&1',
                        escapeshellarg($script),
                        escapeshellarg($baseSwf),
                        escapeshellarg($itemsDir),
                        escapeshellarg($frPlayerSwf),
                        $frGender,
                        escapeshellarg($frHair),
                        escapeshellarg($frClothing),
                        escapeshellarg($frWeapon),
                        escapeshellarg($frBack),
                        escapeshellarg($frHairColor)
                    );
                    shell_exec($cmdFr);
                }

                if (is_file($frPlayerSwf)) {
                    $allyPaths[] = $frPlayerSwf;
                    $allySkillsSpecs[] = !empty($frSkillsList) ? implode('+', $frSkillsList) : 'none';
                    continue;
                }
            }

            $np = $this->basePath() . DIRECTORY_SEPARATOR . 'npcs' . DIRECTORY_SEPARATOR . $aid . '.swf';
            if (!is_file($np)) {
                $np = $this->basePath() . DIRECTORY_SEPARATOR . 'npcs' . DIRECTORY_SEPARATOR . 'npc_3.swf';
            }
            if (is_file($np)) {
                $allyPaths[] = $np;
                $allySkillsSpecs[] = 'none';
            }
        }
        $alliesKey = implode('_', $allyParts);
        $allyPathsCsv = implode(',', $allyPaths);
        $allySkillsCsv = implode(',', $allySkillsSpecs);

        $baseSwf = storage_path('app/swf_base/player_base.swf');
        $script = base_path('scripts/swf_builder.py');
        $itemsDir = $this->basePath() . DIRECTORY_SEPARATOR . 'items';
        $skillsDir = $this->basePath() . DIRECTORY_SEPARATOR . 'skills';

        if (!is_file($baseSwf)) {
            $ninjaSageSwf = $this->basePath() . DIRECTORY_SEPARATOR . 'NinjaSage.swf';
            if (is_file($ninjaSageSwf) && is_file($script)) {
                $cmd = sprintf(
                    'python3 %s extract-player-base %s %s 2>&1',
                    escapeshellarg($script),
                    escapeshellarg($ninjaSageSwf),
                    escapeshellarg($baseSwf)
                );
                shell_exec($cmd);
            }
        }

        $hash = substr(md5("{$gender}|{$hair}|{$clothing}|{$weapon}|{$back}|{$skillsCsv}|{$bgName}|{$alliesKey}|{$allySkillsCsv}|v38_36fps_pets"), 0, 12);
        $cacheDir = storage_path('app/swf_cache');
        if (!is_dir($cacheDir)) {
            @mkdir($cacheDir, 0775, true);
        }
        $cachedPath = $cacheDir . DIRECTORY_SEPARATOR . "battle_{$charId}_{$enemiesKey}_{$hash}.swf";

        if (!is_file($cachedPath)) {
            $cmd = sprintf(
                'python3 %s build-battle %s %s %s %s %s %d %s %s %s %s %s %s %s %s 2>&1',
                escapeshellarg($script),
                escapeshellarg($baseSwf),
                escapeshellarg($itemsDir),
                escapeshellarg($enemyPathsCsv),
                escapeshellarg($skillsDir),
                escapeshellarg($cachedPath),
                $gender,
                escapeshellarg($hair),
                escapeshellarg($clothing),
                escapeshellarg($weapon),
                escapeshellarg($back),
                escapeshellarg($skillsCsv),
                escapeshellarg($bgPath),
                escapeshellarg($allyPathsCsv),
                escapeshellarg($allySkillsCsv)
            );
            shell_exec($cmd);
        }

        if (!is_file($cachedPath)) {
            return response()->json(['error' => 'Failed compiling unified battle SWF'], 500);
        }

        return response()->file($cachedPath, [
            'Content-Type' => 'application/x-shockwave-flash',
            'Cache-Control' => 'no-cache, public',
            'Access-Control-Allow-Origin' => '*',
        ]);
    }

    public function playerSkill(int $charId, string $skillId, Request $request): BinaryFileResponse|JsonResponse
    {
        $skillName = preg_replace('/[^a-zA-Z0-9_-]/', '', pathinfo($skillId, PATHINFO_FILENAME));
        if (!$skillName) {
            return response()->json(['error' => 'Invalid skill ID'], 400);
        }

        $skillsDir = $this->basePath() . DIRECTORY_SEPARATOR . 'skills';
        $itemsDir = $this->basePath() . DIRECTORY_SEPARATOR . 'items';
        $skillPath = $skillsDir . DIRECTORY_SEPARATOR . $skillName . '.swf';

        if (!is_file($skillPath)) {
            $swfAlias = Skill::where('skill_id', $skillName)->value('swf');
            $fallbackName = $swfAlias ? ($swfAlias . '.swf') : env('SKILL_DEFAULT_SWF', 'skill_01.swf');
            $fallbackPath = $skillsDir . DIRECTORY_SEPARATOR . $fallbackName;
            if (is_file($fallbackPath)) {
                $skillPath = $fallbackPath;
            }
        }

        if (!is_file($skillPath)) {
            return response()->json(['error' => 'Skill SWF not found'], 404);
        }

        $char = Character::find($charId);
        $gender = (int) ($char?->gender ?? 0);
        $gSuffix = $gender === 0 ? '_0' : '_1';
        $cleanId = static fn (?string $v): string => preg_replace('/[^a-zA-Z0-9_-]/', '', (string) $v) ?? '';
        $hair = $cleanId($request->query('hair')) ?: (string) ($char?->hair_style ?: "hair_01{$gSuffix}");
        $clothing = $cleanId($request->query('clothing')) ?: (string) ($char?->equipment_clothing ?: "set_01{$gSuffix}");
        $weapon = $cleanId($request->query('weapon')) ?: (string) ($char?->equipment_weapon ?: 'wpn_01');
        $back = $cleanId($request->query('back')) ?: (string) ($char?->equipment_back ?: 'back_01');

        $equipHash = substr(md5("{$gender}|{$hair}|{$clothing}|{$weapon}|{$back}|v19"), 0, 12);
        $cacheDir = storage_path('app/swf_cache');
        if (!is_dir($cacheDir)) {
            @mkdir($cacheDir, 0775, true);
        }
        $cachedPath = $cacheDir . DIRECTORY_SEPARATOR . "pskill_{$charId}_{$skillName}_{$equipHash}.swf";

        if (!is_file($cachedPath)) {
            $script = base_path('scripts/swf_builder.py');
            $cmd = sprintf(
                'python3 %s build-player-skill %s %s %s %d %s %s %s %s 2>&1',
                escapeshellarg($script),
                escapeshellarg($skillPath),
                escapeshellarg($itemsDir),
                escapeshellarg($cachedPath),
                $gender,
                escapeshellarg($hair),
                escapeshellarg($clothing),
                escapeshellarg($weapon),
                escapeshellarg($back)
            );
            shell_exec($cmd);
        }

        if (!is_file($cachedPath)) {
            return response()->json(['error' => 'Failed compiling dressed skill SWF'], 500);
        }

        return response()->file($cachedPath, [
            'Content-Type' => 'application/x-shockwave-flash',
            'Cache-Control' => 'no-cache, public',
            'Access-Control-Allow-Origin' => '*',
        ]);
    }

    public function playerPreview(Request $request): BinaryFileResponse|JsonResponse
    {
        $gender = ((int) $request->query('gender', 0)) === 1 ? 1 : 0;
        $gSuffix = $gender === 0 ? '_0' : '_1';
        $cleanId = static fn (?string $v): string => preg_replace('/[^a-zA-Z0-9_-]/', '', (string) $v) ?? '';
        $hairNum = max(1, min(30, (int) $request->query('hair_num', 1)));
        $hairPad = str_pad((string) $hairNum, 2, '0', STR_PAD_LEFT);
        $hair = $cleanId($request->query('hair')) ?: "hair_{$hairPad}{$gSuffix}";
        $hairColor = preg_replace('/[^0-9|]/', '', (string) $request->query('hair_color', '0|0')) ?? '0|0';
        $clothing = $cleanId($request->query('clothing')) ?: "set_01{$gSuffix}";
        $weapon = $cleanId($request->query('weapon')) ?: 'wpn_01';
        $back = $cleanId($request->query('back')) ?: 'back_01';

        $baseSwf = storage_path('app/swf_base/player_base.swf');
        $script = base_path('scripts/swf_builder.py');
        $itemsDir = $this->basePath() . DIRECTORY_SEPARATOR . 'items';

        if (!is_file($baseSwf)) {
            $ninjaSageSwf = $this->basePath() . DIRECTORY_SEPARATOR . 'NinjaSage.swf';
            if (is_file($ninjaSageSwf) && is_file($script)) {
                shell_exec(sprintf(
                    'python3 %s extract-player-base %s %s 2>&1',
                    escapeshellarg($script),
                    escapeshellarg($ninjaSageSwf),
                    escapeshellarg($baseSwf)
                ));
            }
        }

        if (!is_file($baseSwf)) {
            return response()->json(['error' => 'player_base.swf unavailable'], 500);
        }

        $hash = substr(md5("{$gender}|{$hair}|{$hairColor}|{$clothing}|{$weapon}|{$back}|preview|v22"), 0, 12);
        $cacheDir = storage_path('app/swf_cache');
        if (!is_dir($cacheDir)) {
            @mkdir($cacheDir, 0775, true);
        }
        $cachedPath = $cacheDir . DIRECTORY_SEPARATOR . "preview_{$hash}.swf";

        if (!is_file($cachedPath)) {
            shell_exec(sprintf(
                'python3 %s build-player %s %s %s standby %d %s %s %s %s %s %s 2>&1',
                escapeshellarg($script),
                escapeshellarg($baseSwf),
                escapeshellarg($itemsDir),
                escapeshellarg($cachedPath),
                $gender,
                escapeshellarg($hair),
                escapeshellarg($clothing),
                escapeshellarg($weapon),
                escapeshellarg($back),
                escapeshellarg(''),
                escapeshellarg($hairColor)
            ));
        }

        if (!is_file($cachedPath)) {
            return response()->json(['error' => 'Failed compiling preview SWF'], 500);
        }

        return response()->file($cachedPath, [
            'Content-Type' => 'application/x-shockwave-flash',
            'Cache-Control' => 'public, max-age=3600',
            'Access-Control-Allow-Origin' => '*',
        ]);
    }

    public function skillIcons(Request $request): BinaryFileResponse|JsonResponse
    {
        $rawSkills = (string) $request->query('skills', 'skill_01');
        $cleanList = array_slice(array_filter(array_map(function ($s) {
            return preg_replace('/[^a-zA-Z0-9_-]/', '', trim($s));
        }, explode(',', $rawSkills))), 0, 8);

        if (empty($cleanList)) {
            $cleanList = ['skill_01'];
        }
        $skillsCsv = implode(',', $cleanList);
        $hash = substr(md5($skillsCsv . '|v25_hd'), 0, 12);

        $cacheDir = storage_path('app/swf_cache');
        if (!is_dir($cacheDir)) {
            @mkdir($cacheDir, 0775, true);
        }
        $cachedPath = $cacheDir . DIRECTORY_SEPARATOR . "skill_icons_{$hash}.swf";

        if (!is_file($cachedPath)) {
            $script = base_path('scripts/swf_builder.py');
            $skillsDir = $this->basePath() . DIRECTORY_SEPARATOR . 'skills';
            $cmd = sprintf(
                'python3 %s build-skill-icons %s %s %s 2>&1',
                escapeshellarg($script),
                escapeshellarg($skillsDir),
                escapeshellarg($skillsCsv),
                escapeshellarg($cachedPath)
            );
            shell_exec($cmd);
        }

        if (!is_file($cachedPath)) {
            return response()->json(['error' => 'Failed compiling skill icons SWF'], 500);
        }

        return response()->file($cachedPath, [
            'Content-Type' => 'application/x-shockwave-flash',
            'Cache-Control' => 'public, max-age=3600',
            'Access-Control-Allow-Origin' => '*',
        ]);
    }

    private function compileEntitySwf(string $inputPath, string $cacheName, string $anim, bool $preview = false): ?string
    {
        $script = base_path('scripts/swf_builder.py');
        if (!is_file($script)) {
            return null;
        }
        $cacheDir = storage_path('app/swf_cache');
        if (!is_dir($cacheDir)) {
            @mkdir($cacheDir, 0775, true);
        }
        $cachedPath = $cacheDir . DIRECTORY_SEPARATOR . $cacheName;
        if (!is_file($cachedPath)) {
            $cmd = sprintf(
                'python3 %s build-entity %s %s %s%s 2>&1',
                escapeshellarg($script),
                escapeshellarg($inputPath),
                escapeshellarg($cachedPath),
                escapeshellarg($anim),
                $preview ? ' preview' : ''
            );
            shell_exec($cmd);
        }
        return is_file($cachedPath) ? $cachedPath : null;
    }

    private function compileSkillSwf(string $inputPath, string $cacheName): ?string
    {
        $script = base_path('scripts/swf_builder.py');
        if (!is_file($script)) {
            return null;
        }
        $cacheDir = storage_path('app/swf_cache');
        if (!is_dir($cacheDir)) {
            @mkdir($cacheDir, 0775, true);
        }
        $cachedPath = $cacheDir . DIRECTORY_SEPARATOR . $cacheName;
        if (!is_file($cachedPath)) {
            $cmd = sprintf(
                'python3 %s build-skill %s %s 2>&1',
                escapeshellarg($script),
                escapeshellarg($inputPath),
                escapeshellarg($cachedPath)
            );
            shell_exec($cmd);
        }
        return is_file($cachedPath) ? $cachedPath : null;
    }

    private function basePath(): string
    {
        $configured = env('SWF_ASSETS_PATH');
        if ($configured && is_dir($configured)) {
            return rtrim($configured, DIRECTORY_SEPARATOR);
        }

        $dockerDefault = '/var/www/swf-assets';
        if (is_dir($dockerDefault)) {
            return $dockerDefault;
        }

        $repoDefault = realpath(base_path('../../../Custom Client/NS Custom Client V1'));
        return $repoDefault ?: base_path('public');
    }
}
