<?php

namespace App\Services\Amf\CharacterService;

use App\Models\Character;
use App\Services\Amf\Concerns\ValidatesSession;
use Illuminate\Support\Facades\Log;

class EquipmentService
{
    use ValidatesSession;

    /**
     * equipSet
     */
    public function equipSet($charId, $sessionKey, $weapon, $backItem, $clothing, $accessory, $hair, $hairColor, $skinColor)
    {
        $guard = $this->guardCharacterSession((int)$charId, $sessionKey);
        if ($guard) {
            return $guard;
        }

        Log::info("AMF Equip Set: Char $charId");

        try {
            $char = Character::find($charId);
            if (!$char) return ['status' => 0, 'error' => 'Character not found'];

            $char->update([
                'equipment_weapon' => $weapon,
                'equipment_back' => $backItem,
                'equipment_clothing' => $clothing,
                'equipment_accessory' => $accessory,
                'hair_style' => $hair,
                'hair_color' => $hairColor,
                'skin_color' => $skinColor
            ]);

            return ['status' => 1];

        } catch (\Exception $e) {
            Log::error("Equip Set Error: " . $e->getMessage());
            return ['status' => 0, 'error' => 'Internal Server Error'];
        }
    }

    /**
     * setPoints
     */
    public function setPoints($charId, $sessionKey, $wind, $fire, $lightning, $water, $earth, $free)
    {
        $guard = $this->guardCharacterSession((int)$charId, $sessionKey);
        if ($guard) {
            return $guard;
        }

        Log::info("AMF Set Points: Char $charId");

        try {
            $char = Character::find($charId);
            if (!$char) return ['status' => 0, 'error' => 'Character not found'];

            $char->update([
                'point_wind' => $wind,
                'point_fire' => $fire,
                'point_lightning' => $lightning,
                'point_water' => $water,
                'point_earth' => $earth,
                'point_free' => $free,
            ]);

            return ['status' => 1, 'error' => 0];

        } catch (\Exception $e) {
            Log::error("Set Points Error: " . $e->getMessage());
            return ['status' => 0, 'error' => 'Internal Server Error'];
        }
    }

    /**
     * resetElement
     * Resets one learned element (1=Wind, 2=Fire, 3=Lightning, 4=Earth, 5=Water),
     * refunds its invested attribute points to point_free, and removes skills of that element.
     */
    public function resetElement($charId, $sessionKey, $elementId)
    {
        $guard = $this->guardCharacterSession((int) $charId, $sessionKey);
        if ($guard) {
            return $guard;
        }

        $elemId = (int) $elementId;
        if ($elemId < 1 || $elemId > 5) {
            return ['status' => 0, 'error' => 'Invalid element ID.'];
        }

        Log::info("AMF Reset Element: Char $charId Element $elemId");

        try {
            $char = Character::find($charId);
            if (!$char) {
                return ['status' => 0, 'error' => 'Character not found.'];
            }

            $slots = array_values(array_filter(
                [(int) $char->element_1, (int) $char->element_2, (int) $char->element_3],
                fn ($v) => $v > 0
            ));

            if (!in_array($elemId, $slots, true)) {
                return ['status' => 0, 'error' => 'Element is not learned by this character.'];
            }

            $remaining = array_values(array_filter($slots, fn ($v) => $v !== $elemId));
            $char->element_1 = $remaining[0] ?? 0;
            $char->element_2 = $remaining[1] ?? 0;
            $char->element_3 = $remaining[2] ?? 0;

            // Refund attribute points for the reset element back to point_free
            $pointColMap = [
                1 => 'point_wind',
                2 => 'point_fire',
                3 => 'point_lightning',
                4 => 'point_earth',
                5 => 'point_water',
            ];
            $col = $pointColMap[$elemId] ?? null;
            if ($col && (int) $char->{$col} > 0) {
                $char->point_free = (int) $char->point_free + (int) $char->{$col};
                $char->{$col} = 0;
            }

            // Remove learned & equipped skills belonging to the reset element
            $elemSkillIds = \App\Models\Skill::where('element', $elemId)->pluck('skill_id')->all();
            if (!empty($elemSkillIds)) {
                \App\Models\CharacterSkill::where('character_id', $charId)
                    ->whereIn('skill_id', $elemSkillIds)
                    ->delete();

                $equipped = array_values(array_filter(
                    array_map('trim', explode(',', (string) $char->equipment_skills)),
                    fn ($sid) => $sid !== '' && !in_array($sid, $elemSkillIds, true)
                ));
                $char->equipment_skills = implode(',', $equipped);
            }

            $char->save();

            return [
                'status' => 1,
                'error' => 0,
                'element_1' => (int) $char->element_1,
                'element_2' => (int) $char->element_2,
                'element_3' => (int) $char->element_3,
            ];
        } catch (\Exception $e) {
            Log::error("Reset Element Error: " . $e->getMessage());
            return ['status' => 0, 'error' => 'Internal Server Error'];
        }
    }

    /**
     * equipSkillSet
     */
    public function equipSkillSet($charId, $sessionKey, $skillString)
    {
        $guard = $this->guardCharacterSession((int)$charId, $sessionKey);
        if ($guard) {
            return $guard;
        }

        Log::info("AMF Equip Skill Set: Char $charId Skills $skillString");

        try {
            $char = Character::find($charId);
            if (!$char) return ['status' => 0, 'error' => 'Character not found'];

            $char->update([
                'equipment_skills' => (string) ($skillString ?? ''),
            ]);

            return ['status' => 1, 'error' => 0];

        } catch (\Exception $e) {
            Log::error("Equip Skill Set Error: " . $e->getMessage());
            return ['status' => 0, 'error' => 'Internal Server Error'];
        }
    }
}
