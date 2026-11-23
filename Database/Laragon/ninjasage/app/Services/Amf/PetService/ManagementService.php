<?php

namespace App\Services\Amf\PetService;

use App\Models\Character;
use App\Models\CharacterItem;
use App\Models\CharacterPet;
use App\Models\User;
use App\Services\Amf\Concerns\ValidatesSession;
use Illuminate\Support\Facades\Log;

class ManagementService
{
    use ValidatesSession;

    /**
     * releasePet
     */
    public function releasePet($params)
    {
        $guard = $this->guardCharacterSessionFromParams($params);
        if ($guard) {
            return $guard;
        }

        $charId = $params[0];
        $sessionKey = $params[1];
        $petId = $params[2];

        Log::info("AMF PetService.releasePet: Char $charId Pet $petId");

        $char = Character::find($charId);
        if (!$char) return ['status' => 0, 'error' => 'Character not found'];

        // Find the pet
        $pet = CharacterPet::where('character_id', $charId)->where('id', $petId)->first();

        if (!$pet) {
            return ['status' => 0, 'error' => 'Pet not found'];
        }

        // Check if equipped
        if ($char->equipment_pet == $pet->id) {
            return ['status' => 0, 'error' => 'Cannot release an equipped pet! Unequip it first.'];
        }

        // Delete pet
        $pet->delete();

        return ['status' => 1];
    }

    /**
     * renamePet
     */
    public function renamePet($charIdOrParams, $sessionKey = null, $petId = null, $newName = null)
    {
        if (is_array($charIdOrParams)) {
            $charId = $charIdOrParams[0];
            $sessionKey = $charIdOrParams[1] ?? null;
            $petId = $charIdOrParams[2] ?? null;
            $newName = $charIdOrParams[3] ?? null;
        } else {
            $charId = $charIdOrParams;
        }

        $guard = $this->guardCharacterSession((int)$charId, $sessionKey);
        if ($guard) {
            return $guard;
        }

        Log::info("AMF PetService.renamePet: Char $charId Pet $petId Name $newName");

        $char = Character::find($charId);
        if (!$char) return ['status' => 0, 'error' => 'Character not found.'];

        $user = User::find($char->user_id);
        if (!$user) return ['status' => 0, 'error' => 'User not found.'];

        $requiredQty = ($user->account_type >= 1) ? 1 : 3; // Premium/Admin: 1, Free: 3

        $renameItem = CharacterItem::where('character_id', $charId)
            ->where('item_id', 'essential_01')
            ->first();

        if (!$renameItem || $renameItem->quantity < $requiredQty) {
            return ['status' => 2, 'result' => "You need $requiredQty Rename Badge(s) to rename your pet."];
        }

        $pet = CharacterPet::where('character_id', $charId)->where('id', $petId)->first();

        if (!$pet) {
            return ['status' => 0, 'error' => 'Pet not found.'];
        }

        $pet->update(['name' => $newName]);

        // Deduct item
        $renameItem->quantity -= $requiredQty;
        if ($renameItem->quantity <= 0) {
            $renameItem->delete();
        } else {
            $renameItem->save();
        }

        return ['status' => 1];
    }

    /**
     * learnPetSkill
     * Params: [char_id, session_key, pet_instance_id, skill_index]
     */
    public function learnPetSkill($params)
    {
        $guard = $this->guardCharacterSessionFromParams($params);
        if ($guard) {
            return $guard;
        }

        $charId = (int) ($params[0] ?? 0);
        $petInstanceId = (int) ($params[2] ?? 0);
        $skillIndex = (int) ($params[3] ?? -1);

        if ($skillIndex < 0 || $skillIndex > 5) {
            return ['status' => 0, 'error' => 'Invalid pet skill slot.'];
        }

        $char = Character::find($charId);
        if (!$char) {
            return ['status' => 0, 'error' => 'Character not found.'];
        }

        $pet = CharacterPet::where('character_id', $charId)->where('id', $petInstanceId)->first();
        if (!$pet) {
            return ['status' => 0, 'error' => 'Pet not found.'];
        }

        $bits = array_pad(
            array_map('intval', explode(',', !empty($pet->learned_skills) ? $pet->learned_skills : '1,0,0,0,0,0')),
            6,
            0
        );

        if ($bits[$skillIndex] === 1) {
            return ['status' => 2, 'result' => 'Jurus pet ini sudah dipelajari.'];
        }

        // Resolve required level from pets.json (fallback: 1, 5, 10, 15, 20, 25)
        $fallbackLevels = [1, 5, 10, 15, 20, 25];
        $reqLevel = $fallbackLevels[$skillIndex] ?? 1;
        $skillName = 'Skill #' . ($skillIndex + 1);

        $petsJsonPath = public_path('game_data/pets.json');
        if (is_file($petsJsonPath)) {
            $decoded = json_decode((string) file_get_contents($petsJsonPath), true);
            if (is_array($decoded)) {
                foreach ($decoded as $entry) {
                    if (($entry['id'] ?? '') === $pet->pet_id && !empty($entry['attacks'][$skillIndex])) {
                        $atk = $entry['attacks'][$skillIndex];
                        $reqLevel = max(1, (int) ($atk['level'] ?? $reqLevel));
                        $skillName = (string) ($atk['name'] ?? $skillName);
                        break;
                    }
                }
            }
        }

        if ((int) $pet->level < $reqLevel) {
            return [
                'status' => 2,
                'result' => "Pet harus mencapai Lv.{$reqLevel} untuk mempelajari {$skillName}.",
            ];
        }

        $goldCost = max(500, $reqLevel * 500);
        if ((int) $char->gold < $goldCost) {
            return [
                'status' => 2,
                'result' => "Gold tidak cukup. Butuh " . number_format($goldCost) . " Gold.",
            ];
        }

        $char->gold = (int) $char->gold - $goldCost;
        $char->save();

        $bits[$skillIndex] = 1;
        $newSkillsStr = implode(',', array_slice($bits, 0, 6));
        $pet->learned_skills = $newSkillsStr;
        $pet->save();

        return [
            'status' => 1,
            'result' => "Berhasil mempelajari jurus {$skillName}!",
            'pet_skills' => $newSkillsStr,
            'character_gold' => (int) $char->gold,
        ];
    }
}
