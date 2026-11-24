<?php

namespace App\Services\Amf;

use App\Models\Character;
use App\Models\CharacterEventData;
use App\Models\GameEvent;
use App\Services\Amf\Concerns\ValidatesSession;
use Illuminate\Support\Facades\Log;

/**
 * LeaderboardService AMF Service
 *
 * Backs the standalone "Leaderboard" external SWF panel opened from ChristmasMenu.
 * The Flash client calls: LeaderboardService.getData([charId, sessionKey, category])
 *
 * Returns a ranked list of characters by event battles won (christmas_2025 event).
 *
 * Response shape:
 * {
 *   status: 1,
 *   title: "Eternal Winter Leaderboard",
 *   kill_text: "Battles Won",
 *   freeze: null,
 *   categories: [["christmas_2025", "Battle Rankings"]],
 *   data: [{ char_id, name, kill, rank, sets: { hair_style, face, hair_color, skin_color } }],
 *   rewards: { "1": [...], "2-3": [...], "4-10": [...], "11-50": [...] }
 * }
 */
class LeaderboardService
{
    use ValidatesSession;

    private const EVENT_KEY      = 'christmas_2025';
    private const ENERGY_MAX     = 10;
    private const TOP_LIMIT      = 100;
    private const CATEGORIES     = [
        ['level', 'Top Level'],
        ['rank', 'Top Rank'],
        ['gold', 'Top Gold'],
        ['christmas_2025', 'Event Battles'],
    ];

    /**
     * Params: charId, sessionKey, category (nullable on first load)
     */
    public function getData($charId, $sessionKey, $category = null)
    {
        $guard = $this->guardCharacterSession((int) $charId, $sessionKey);
        if ($guard) return $guard;

        Log::info("AMF LeaderboardService.getData: Char $charId Category $category");

        // Use the selected category or default to top level
        $eventKey = $category ?: 'level';

        $data = [];
        $title = 'Shinobi Leaderboard';
        $killText = 'Level';

        if (in_array($eventKey, ['level', 'rank', 'gold'], true)) {
            $query = Character::query();
            if ($eventKey === 'level') {
                $query->orderByDesc('level')->orderByDesc('xp');
                $title = 'Shinobi Level Leaderboard';
                $killText = 'Level';
            } elseif ($eventKey === 'rank') {
                $query->orderByDesc('rank')->orderByDesc('level');
                $title = 'Shinobi Rank Leaderboard';
                $killText = 'Rank';
            } else {
                $query->orderByDesc('gold')->orderByDesc('level');
                $title = 'Wealthiest Shinobi';
                $killText = 'Gold';
            }

            foreach ($query->limit(self::TOP_LIMIT)->get() as $char) {
                $genderSuffix = $char->gender == 0 ? '_0' : '_1';
                $hairStyle = is_numeric($char->hair_style)
                    ? 'hair_' . str_pad($char->hair_style, 2, '0', STR_PAD_LEFT) . $genderSuffix
                    : ($char->hair_style ?: ('hair_01' . $genderSuffix));

                $score = $eventKey === 'level'
                    ? (int) $char->level
                    : ($eventKey === 'rank' ? (int) $char->rank : (int) $char->gold);

                $data[] = [
                    'char_id' => (int) $char->id,
                    'name'    => $char->name,
                    'level'   => (int) $char->level,
                    'kill'    => $score,
                    'rank'    => (int) $char->rank,
                    'sets'    => [
                        'hair_style'  => $hairStyle,
                        'face'        => 'face_01' . $genderSuffix,
                        'hair_color'  => $char->hair_color ?? '0|0',
                        'skin_color'  => $char->skin_color ?? 'null|null',
                    ],
                ];
            }
        } else {
            $title = 'Event Battle Leaderboard';
            $killText = 'Battles Won';
            // Retrieve top characters by event battle count
            $topEntries = CharacterEventData::where('event_key', $eventKey)
                ->where('battles', '>', 0)
                ->orderByDesc('battles')
                ->limit(self::TOP_LIMIT)
                ->get();

            foreach ($topEntries as $entry) {
                $char = Character::find($entry->character_id);
                if (!$char) continue;

                $genderSuffix = $char->gender == 0 ? '_0' : '_1';
                if (is_numeric($char->hair_style)) {
                    $hairStyle = 'hair_' . str_pad($char->hair_style, 2, '0', STR_PAD_LEFT) . $genderSuffix;
                } else {
                    $hairStyle = $char->hair_style ?: ('hair_01' . $genderSuffix);
                }

                $data[] = [
                    'char_id' => (int) $char->id,
                    'name'    => $char->name,
                    'level'   => (int) $char->level,
                    'kill'    => (int) $entry->battles,
                    'rank'    => (int) $char->rank,
                    'sets'    => [
                        'hair_style'  => $hairStyle,
                        'face'        => 'face_01' . $genderSuffix,
                        'hair_color'  => $char->hair_color ?? '0|0',
                        'skin_color'  => $char->skin_color ?? 'null|null',
                    ],
                ];
            }
        }

        // Load reward configuration from the active ChristmasMenu GameEvent
        $rewards = $this->getRewardsConfig();

        return [
            'status'     => 1,
            'error'      => 0,
            'title'      => $title,
            'kill_text'  => $killText,
            'freeze'     => null,
            'categories' => self::CATEGORIES,
            'data'       => $data,
            'rewards'    => $rewards,
        ];
    }

    // -------------------------------------------------------------------------

    /**
     * Returns the leaderboard reward tiers from the active ChristmasMenu event config,
     * or sensible defaults if not configured.
     *
     * Shape: { "1": ["item_id", ...], "2-3": [...], "4-10": [...], "11-50": [...] }
     */
    private function getRewardsConfig(): array
    {
        $event = GameEvent::where('panel', 'ChristmasMenu')->where('active', true)->first();
        if ($event && !empty($event->data['leaderboard_rewards'])) {
            return $event->data['leaderboard_rewards'];
        }

        // Default reward tiers
        return [
            '1'     => ['hair_2365_%s', 'set_2406_%s'],
            '2-3'   => ['hair_2366_%s', 'set_2407_%s'],
            '4-10'  => ['material_2229'],
            '11-50' => ['material_2226'],
        ];
    }
}
