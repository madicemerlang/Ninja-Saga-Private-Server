<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Character;
use App\Models\CharacterItem;
use App\Models\Enemy;
use App\Models\GameConfig;
use App\Models\Mission;
use App\Models\Pet;
use App\Models\Talent;
use App\Services\Amf\CharacterService;
use App\Services\Amf\SessionValidator;
use App\Services\Amf\SystemLoginService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;

class MobileGameController extends Controller
{
    /**
     * Allowlist of AMF services accessible via the JSON-RPC bridge.
     */
    private const ALLOWED_SERVICES = [
        'AdvanceAcademyService',
        'BattleSystemService',
        'BlacksmithService',
        'CharacterService',
        'ChuninExamService',
        'ClanService',
        'CrewService',
        'DailyRewardService',
        'DailyRouletteService',
        'DailyScratchService',
        'EudemonGardenService',
        'EventsService',
        'FriendService',
        'GameService',
        'HuntingHouseService',
        'JouninExamService',
        'LeaderboardService',
        'MailService',
        'MaterialMarketService',
        'MysteriousMarketService',
        'NinjaTutorExamService',
        'PetCombinationService',
        'PetService',
        'PvPService',
        'SenjutsuService',
        'ShadowWarService',
        'SpecialDealsService',
        'SpecialJouninExamService',
        'SystemLoginService',
        'TalentService',
        'WelcomeLoginService',
    ];

    public function health(): JsonResponse
    {
        return response()->json([
            'status' => 'ok',
            'service' => 'ninjasage-mobile-api',
            'timestamp' => time(),
            'swf_assets_ready' => is_dir(env('SWF_ASSETS_PATH', '/var/www/swf-assets')),
        ]);
    }

    public function characters(Request $request, SystemLoginService $loginService): JsonResponse
    {
        $uid = (int) ($request->header('X-User-Id') ?? $request->query('uid'));
        $sessionKey = (string) ($request->header('X-Session-Key') ?? $request->query('session_key'));

        if ($error = SessionValidator::validateUser($uid, $sessionKey)) {
            return response()->json($error, 401);
        }

        return response()->json($loginService->getAllCharacters($uid, $sessionKey));
    }

    public function characterShow(Request $request, int $id, SystemLoginService $loginService): JsonResponse
    {
        $sessionKey = (string) ($request->header('X-Session-Key') ?? $request->query('session_key'));

        if ($error = SessionValidator::validateCharacter($id, $sessionKey)) {
            return response()->json($error, 401);
        }

        $data = $loginService->getCharacterData($id, $sessionKey);
        if (is_array($data)) {
            $char = Character::find($id);
            if ($char) {
                $nextXp = (int) (\App\Models\XP::where('level', $char->level)->value('character_xp') ?: ($char->level * 100));
                $prevXp = $char->level > 1
                    ? (int) (\App\Models\XP::where('level', $char->level - 1)->value('character_xp') ?: 0)
                    : 0;
                $data['next_level_xp'] = $nextXp;
                $data['prev_level_xp'] = $prevXp;
                $data['senjutsu_type'] = $char->senjutsu_type;
                $data['character_ss'] = (int) ($char->ss ?? 0);
                $data['senjutsu_skills'] = (string) ($char->senjutsu_skills ?? '');
            }
            $user = $char ? \App\Models\User::find($char->user_id) : null;
            if ($user) {
                $tokens = (int) $user->tokens;
                $accType = (int) ($user->account_type ?? 0);
                $data['account_tokens'] = $tokens;
                $data['account_type'] = $accType;
                if (isset($data['account_data']) && is_array($data['account_data'])) {
                    $data['account_data']['account_tokens'] = $tokens;
                    $data['account_data']['account_type'] = $accType;
                } else {
                    $data['account_data'] = ['account_tokens' => $tokens, 'account_type' => $accType];
                }
            }
        }

        return response()->json($data);
    }

    public function characterDelete(Request $request, int $id): JsonResponse
    {
        $uid = (int) ($request->header('X-User-Id') ?? $request->input('uid'));
        $sessionKey = (string) ($request->header('X-Session-Key') ?? $request->input('session_key'));

        if ($error = SessionValidator::validateUser($uid, $sessionKey)) {
            return response()->json($error, 401);
        }

        $char = Character::where('id', $id)->where('user_id', $uid)->first();
        if (!$char) {
            return response()->json(['status' => 0, 'error' => 'Character not found.'], 404);
        }

        $charName = $char->name;
        \Illuminate\Support\Facades\DB::transaction(function () use ($char) {
            // Delete character-owned records only; account-bound users.tokens remains completely intact!
            $char->delete();
        });

        $user = \App\Models\User::find($uid);
        return response()->json([
            'status' => 1,
            'message' => "Character {$charName} deleted.",
            'account_tokens' => (int) ($user?->tokens ?? 0),
        ]);
    }

    public function characterCreate(Request $request, CharacterService $characterService): JsonResponse
    {
        $uid = (int) ($request->header('X-User-Id') ?? $request->input('uid'));
        $sessionKey = (string) ($request->header('X-Session-Key') ?? $request->input('session_key'));

        if ($error = SessionValidator::validateUser($uid, $sessionKey)) {
            return response()->json($error, 401);
        }

        if (is_array($request->input('params'))) {
            $params = $request->input('params');
        } else {
            $validated = $request->validate([
                'name' => ['required', 'string', 'min:2', 'max:24'],
                'gender' => ['nullable', 'integer', 'in:0,1'],
                'element' => ['nullable', 'integer', 'between:1,5'],
                'hair_color' => ['nullable', 'string'],
                'hair_num' => ['nullable', 'integer', 'min:1', 'max:30'],
            ]);

            $params = [
                $uid,
                $sessionKey,
                $validated['name'],
                (int) ($validated['gender'] ?? 0),
                (int) ($validated['element'] ?? 3),
                (string) ($validated['hair_color'] ?? '0|0'),
                (int) ($validated['hair_num'] ?? 1),
            ];
        }

        $result = $characterService->characterRegister($params);
        $ok = is_array($result) && (($result['status'] ?? 0) === 1);

        return response()->json($result, $ok ? 201 : 422);
    }

    public function battleStart(Request $request): JsonResponse
    {
        $charId = (int) ($request->header('X-Character-Id') ?? $request->input('char_id'));
        $sessionKey = (string) ($request->header('X-Session-Key') ?? $request->input('session_key'));

        if ($error = SessionValidator::validateCharacter($charId, $sessionKey)) {
            return response()->json($error, 401);
        }

        $validated = $request->validate([
            'mission_id' => ['required', 'string'],
            'enemy_ids' => ['nullable', 'array'],
            'hunting_zone_id' => ['nullable', 'integer', 'min:1', 'max:5'],
        ]);

        $char = Character::find($charId);
        if (!$char) {
            return response()->json(['status' => 0, 'error' => 'Character not found'], 404);
        }

        $missionId = $validated['mission_id'];
        $huntingZoneId = $validated['hunting_zone_id'] ?? null;

        if ($huntingZoneId !== null) {
            $zoneMap = [
                1 => ['name' => 'Hunting Zone 1: Ginkotsu', 'enemies' => ['ene_81'], 'badges' => 1],
                2 => ['name' => 'Hunting Zone 2: Paper & Stone', 'enemies' => ['ene_82', 'ene_83'], 'badges' => 2],
                3 => ['name' => 'Hunting Zone 3: Tengu - Fire', 'enemies' => ['ene_84'], 'badges' => 1],
                4 => ['name' => 'Hunting Zone 4: Turtle & General', 'enemies' => ['ene_120', 'ene_155'], 'badges' => 3],
                5 => ['name' => 'Hunting Zone 5: Ape King & Orochi', 'enemies' => ['ene_106', 'ene_101'], 'badges' => 4],
            ];
            $z = $zoneMap[$huntingZoneId] ?? $zoneMap[1];
            $enemyIds = !empty($validated['enemy_ids']) ? $validated['enemy_ids'] : $z['enemies'];
            $reqLvl = 1;
            $missionName = $z['name'];
            $missionBg = 'mission_01';
            $rewardGold = max(200, (int) $char->level * 200);
            $rewardXp = max(100, (int) $char->level * 100);
            $huntingBadges = $z['badges'];
        } else {
            $mission = Mission::where('mission_id', $missionId)->first();
            if (!$mission && str_starts_with($missionId, 'msn_')) {
                $num = intval(substr($missionId, 4));
                $mission = Mission::where('mission_id', 'msn_' . str_pad((string) $num, 2, '0', STR_PAD_LEFT))->first();
            }

            $missionDef = $this->findMissionJson($missionId);
            if (!$mission && !$missionDef) {
                return response()->json(['status' => 0, 'error' => "Mission '$missionId' not found"], 404);
            }

            $reqLvl = (int) ($mission->req_lvl ?? $missionDef['level'] ?? 1);
            if ($char->level < $reqLvl) {
                return response()->json(['status' => 0, 'error' => "Level too low (requires Lv.$reqLvl)"], 422);
            }

            $enemyIds = $missionDef['enemies'] ?? ['ene_01'];
            $missionName = $missionDef['name'] ?? $mission?->name ?? $missionId;
            $missionBg = $missionDef['bg'] ?? 'mission_01';
            $rewardGold = (int) ($mission->gold ?? $missionDef['rewards']['gold'] ?? 20);
            $rewardXp = (int) ($mission->xp ?? $missionDef['rewards']['xp'] ?? 20);
            $huntingBadges = 0;
        }

        $enemyJsonMap = $this->loadEnemyJsonMap();
        $enemies = [];
        foreach ($enemyIds as $eid) {
            $e = Enemy::where('enemy_id', $eid)->first();
            $ej = $enemyJsonMap[$eid] ?? null;

            $eLvl = (int) ($ej['level'] ?? $e?->level ?: $reqLvl ?: 1);
            $calc = (int) ($ej['calculation'] ?? 0);
            $calcAgi = (int) ($ej['calculation_agility'] ?? 0);

            $rawHp = (int) ($ej['hp'] ?? $e?->hp ?? 0);
            if ($rawHp > 0) {
                $hp = $rawHp;
            } elseif ($calc > 0) {
                $hp = $calc * $eLvl;
            } else {
                $hp = 60 + $eLvl * 40;
            }

            $rawCp = (int) ($ej['cp'] ?? $e?->cp ?? 0);
            $cp = $rawCp > 0 ? $rawCp : (60 + $eLvl * 40);

            $rawAgi = (int) ($ej['agility'] ?? $e?->agility ?? 0);
            if ($rawAgi > 0) {
                $agility = $rawAgi;
            } elseif ($calcAgi > 0) {
                $agility = $calcAgi;
            } else {
                $agility = 8 + $eLvl;
            }

            $enemies[] = [
                'id' => $ej['id'] ?? ($e ? $e->enemy_id : $eid),
                'name' => $ej['name'] ?? ($e ? $e->name : $eid),
                'level' => $eLvl,
                'hp' => $hp,
                'cp' => $cp,
                'agility' => $agility,
                'dodge' => (float) ($ej['dodge'] ?? 0),
                'critical' => (float) ($ej['critical'] ?? 5),
                'accuracy' => (float) ($ej['accuracy'] ?? 0),
                'purify' => (float) ($ej['purify'] ?? 5),
                'reactive' => (float) ($ej['reactive'] ?? 5),
                'combustion' => (float) ($ej['combustion'] ?? 0),
            ];
        }

        $token = Str::random(16);

        Cache::put("mobile_battle_{$charId}", [
            'token' => $token,
            'mission_id' => $missionId,
            'reward_gold' => $rewardGold,
            'reward_xp' => $rewardXp,
            'hunting_badges' => $huntingBadges,
        ], now()->addMinutes(30));

        return response()->json([
            'status' => 1,
            'token' => $token,
            'mission' => [
                'id' => $missionId,
                'name' => $missionName,
                'bg' => $missionBg,
                'req_lvl' => $reqLvl,
                'reward_gold' => $rewardGold,
                'reward_xp' => $rewardXp,
            ],
            'enemies' => $enemies,
        ]);
    }

    public function battleFinish(Request $request): JsonResponse
    {
        $charId = (int) ($request->header('X-Character-Id') ?? $request->input('char_id'));
        $sessionKey = (string) ($request->header('X-Session-Key') ?? $request->input('session_key'));

        if ($error = SessionValidator::validateCharacter($charId, $sessionKey)) {
            return response()->json($error, 401);
        }

        $validated = $request->validate([
            'mission_id' => ['required', 'string'],
            'token' => ['required', 'string'],
            'victory' => ['required', 'boolean'],
            'used_items' => ['nullable', 'array'],
        ]);

        $cached = Cache::get("mobile_battle_{$charId}");
        if (!$cached || $cached['token'] !== $validated['token'] || $cached['mission_id'] !== $validated['mission_id']) {
            return response()->json(['status' => 0, 'error' => 'Invalid or expired battle token'], 422);
        }

        Cache::forget("mobile_battle_{$charId}");

        $char = Character::find($charId);
        if (!$char) {
            return response()->json(['status' => 0, 'error' => 'Character not found'], 404);
        }

        // Persist any consumable items used during this battle (applies to victory, defeat, and forfeit!)
        $usedItems = $validated['used_items'] ?? [];
        if (is_array($usedItems) && !empty($usedItems)) {
            foreach ($usedItems as $rawItemId => $rawQty) {
                $itemId = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) $rawItemId);
                $qty = max(0, (int) $rawQty);
                if (!$itemId || $qty <= 0) {
                    continue;
                }
                $row = CharacterItem::where('character_id', $char->id)
                    ->where('item_id', $itemId)
                    ->where('category', 'item')
                    ->first();
                if ($row) {
                    if ($row->quantity <= $qty) {
                        $row->delete();
                    } else {
                        $row->decrement('quantity', $qty);
                    }
                }
            }
        }

        if (!$validated['victory']) {
            return response()->json([
                'status' => 1,
                'victory' => false,
                'xp_reward' => 0,
                'gold_reward' => 0,
                'level' => (int) $char->level,
                'xp' => (int) $char->xp,
                'gold' => (int) $char->gold,
                'level_up' => false,
            ]);
        }

        $user = \App\Models\User::find($char->user_id);
        $isPremium = $user && ((int) ($user->account_type ?? 0) >= 1);

        $goldReward = (int) $cached['reward_gold'];
        $xpReward = (int) $cached['reward_xp'];
        if ($isPremium) {
            $goldReward = (int) round($goldReward * 1.5);
            $xpReward = (int) round($xpReward * 1.5);
        }
        $huntingBadges = (int) ($cached['hunting_badges'] ?? 0);

        $char->gold += $goldReward;
        $levelUp = $char->addXp($xpReward);
        $char->save();

        $droppedItems = [];
        if ($huntingBadges > 0) {
            $mat = CharacterItem::firstOrCreate(
                ['character_id' => $char->id, 'item_id' => 'material_509', 'category' => 'material'],
                ['quantity' => 0]
            );
            $mat->increment('quantity', $huntingBadges);
            $droppedItems[] = "material_509:{$huntingBadges}";

            // Authentic Hunting House Magatama + Boss Weapon drops per zone
            $zoneNum = 1;
            if (preg_match('/hunting_zone_(\d+)/', (string) ($cached['mission_id'] ?? ''), $zm)) {
                $zoneNum = max(1, min(5, (int) $zm[1]));
            }
            $zoneLoot = [
                1 => ['magatama' => 'material_01', 'weapon' => 'wpn_82'],
                2 => ['magatama' => 'material_02', 'weapon' => 'wpn_83'],
                3 => ['magatama' => 'material_03', 'weapon' => 'wpn_84'],
                4 => ['magatama' => 'material_04', 'weapon' => 'wpn_85'],
                5 => ['magatama' => 'material_06', 'weapon' => 'wpn_86'],
            ][$zoneNum];

            $magRow = CharacterItem::firstOrCreate(
                ['character_id' => $char->id, 'item_id' => $zoneLoot['magatama'], 'category' => 'material'],
                ['quantity' => 0]
            );
            $magRow->increment('quantity', 1);
            $droppedItems[] = $zoneLoot['magatama'] . ':1';

            // 25% chance to drop zone Boss Weapon if not already owned
            if (random_int(1, 100) <= 25) {
                $hasWpn = CharacterItem::where('character_id', $char->id)
                    ->where('item_id', $zoneLoot['weapon'])
                    ->exists();
                if (!$hasWpn) {
                    CharacterItem::create([
                        'character_id' => $char->id,
                        'item_id' => $zoneLoot['weapon'],
                        'category' => 'weapon',
                        'quantity' => 1,
                    ]);
                    $droppedItems[] = $zoneLoot['weapon'];
                }
            }
        }

        return response()->json([
            'status' => 1,
            'victory' => true,
            'xp_reward' => $xpReward,
            'gold_reward' => $goldReward,
            'premium_bonus' => $isPremium,
            'badges_reward' => $huntingBadges,
            'dropped_items' => $droppedItems,
            'level' => (int) $char->level,
            'xp' => (int) $char->xp,
            'gold' => (int) $char->gold,
            'level_up' => (bool) $levelUp,
            'level_capped' => $char->isLevelCapped(),
            'cap_exam' => $char->isLevelCapped() ? $char->getNextExamName() : null,
        ]);
    }

    /**
     * Returns server-side feature configuration for Mobile App screens:
     * Advance Academy chains, Blacksmith Forge recipes, Talents catalog, and Pet Shop catalog.
     */
    public function featureData(): JsonResponse
    {
        $recipesPath = app_path('Services/Amf/BlacksmithRecipes.php');
        $blacksmithRecipes = is_file($recipesPath) ? require $recipesPath : [];

        $academyChains = GameConfig::get('academy_chains', []);
        $talentDesc = GameConfig::get('talent_description', []);
        $talentTpCost = GameConfig::get('talent_tp_cost', [
            1 => 5, 2 => 10, 3 => 25, 4 => 50, 5 => 100,
            6 => 200, 7 => 300, 8 => 450, 9 => 600, 10 => 800,
        ]);

        $talentsCatalog = Talent::all()->map(fn ($t) => [
            'talent_id' => $t->talent_id,
            'name' => $t->name,
            'description' => $t->description,
            'price_gold' => (int) ($t->price_gold ?? 0),
            'price_tokens' => (int) ($t->price_tokens ?? 0),
            'is_emblem' => (bool) ($t->is_emblem ?? false),
            'type' => $t->type ?? 'Secret',
        ])->values();

        $petsById = Pet::all()->keyBy('pet_id');
        $petsCatalog = collect();
        $gameDataPath = public_path('game_data/gamedata.json');
        if (File::exists($gameDataPath)) {
            $gd = json_decode(File::get($gameDataPath), true);
            if (is_array($gd)) {
                foreach ($gd as $section) {
                    if (($section['id'] ?? '') === 'pet_shop' && is_array($section['data']['pets'] ?? null)) {
                        foreach ($section['data']['pets'] as $entry) {
                            $pid = (string) ($entry['id'] ?? '');
                            if ($pid === '') continue;
                            $rawPrice = (string) ($entry['price'] ?? '');
                            $priceGold = 0;
                            $priceTokens = 0;
                            if (preg_match('/^(gold|token)_(\d+)(M|K)?$/i', $rawPrice, $m)) {
                                $val = (int) $m[2];
                                $unit = strtoupper($m[3] ?? '');
                                if ($unit === 'M') $val *= 1000000;
                                elseif ($unit === 'K') $val *= 1000;
                                if (strtolower($m[1]) === 'token') $priceTokens = $val;
                                else $priceGold = $val;
                            }
                            $pModel = $petsById->get($pid);
                            $petsCatalog->push([
                                'pet_id' => $pid,
                                'name' => $pModel?->name ?? ucfirst(str_replace('pet_', '', $pid)),
                                'swf' => $pModel?->swf ?: $pid,
                                'price_gold' => $priceGold,
                                'price_tokens' => $priceTokens,
                                'premium' => (bool) ($pModel?->premium ?? false),
                            ]);
                        }
                        break;
                    }
                }
            }
        }
        if ($petsCatalog->isEmpty()) {
            $petsCatalog = $petsById->values()->map(fn ($p) => [
                'pet_id' => $p->pet_id,
                'name' => $p->name,
                'swf' => $p->swf ?: $p->pet_id,
                'price_gold' => (int) ($p->price_gold ?? 0),
                'price_tokens' => (int) ($p->price_tokens ?? 0),
                'premium' => (bool) ($p->premium ?? false),
            ])->values();
        }

        return response()->json([
            'status' => 1,
            'academy_chains' => $academyChains,
            'blacksmith_recipes' => $blacksmithRecipes,
            'talent_description' => $talentDesc,
            'talent_tp_cost' => $talentTpCost,
            'talents_catalog' => $talentsCatalog,
            'pets_catalog' => $petsCatalog,
        ]);
    }

    private function loadEnemyJsonMap(): array
    {
        $path = public_path('game_data/enemy.json');
        if (!File::exists($path)) {
            return [];
        }
        $list = json_decode(File::get($path), true);
        if (!is_array($list)) {
            return [];
        }
        $map = [];
        foreach ($list as $item) {
            if (!empty($item['id'])) {
                $map[$item['id']] = $item;
            }
        }
        return $map;
    }

    private function findMissionJson(string $missionId): ?array
    {
        $path = public_path('game_data/mission.json');
        if (!File::exists($path)) {
            return null;
        }
        $list = json_decode(File::get($path), true);
        if (!is_array($list)) {
            return null;
        }
        foreach ($list as $item) {
            if (($item['id'] ?? '') === $missionId) {
                return $item;
            }
        }
        return null;
    }

    /**
     * Generic whitelisted JSON-RPC bridge to existing App\Services\Amf\* services.
     * Body: { "args": [...], "char_id": 1, "uid": 1 }
     * Header: X-Session-Key: <session_key>
     */
    public function rpc(Request $request, string $service, string $method): JsonResponse
    {
        $serviceClass = str_ends_with($service, 'Service') ? ucfirst($service) : ucfirst($service) . 'Service';

        if (!in_array($serviceClass, self::ALLOWED_SERVICES, true)) {
            return response()->json([
                'status' => 0,
                'error' => "Service '$serviceClass' is not allowed",
            ], 403);
        }

        $sessionKey = (string) ($request->header('X-Session-Key') ?? $request->input('session_key', ''));
        $charId = $request->header('X-Character-Id') ?? $request->input('char_id');
        $uid = $request->header('X-User-Id') ?? $request->input('uid');

        if ($charId !== null) {
            if ($error = SessionValidator::validateCharacter((int) $charId, $sessionKey)) {
                return response()->json($error, 401);
            }
        } elseif ($uid !== null) {
            if ($error = SessionValidator::validateUser((int) $uid, $sessionKey)) {
                return response()->json($error, 401);
            }
        } else {
            return response()->json([
                'status' => 0,
                'error' => 'X-Character-Id or X-User-Id header is required',
            ], 401);
        }

        $fqcn = "App\\Services\\Amf\\{$serviceClass}";
        if (!class_exists($fqcn)) {
            return response()->json(['status' => 0, 'error' => "Service class not found"], 404);
        }

        $instance = app($fqcn);
        if (!method_exists($instance, $method)) {
            return response()->json(['status' => 0, 'error' => "Method '$method' not found"], 404);
        }

        $args = $request->input('args', []);
        if (!is_array($args)) {
            $args = [$args];
        }

        try {
            $result = $instance->{$method}(...array_values($args));
            return response()->json([
                'status' => 1,
                'data' => $result,
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'status' => 0,
                'error' => $e->getMessage(),
            ], 500);
        }
    }
}
