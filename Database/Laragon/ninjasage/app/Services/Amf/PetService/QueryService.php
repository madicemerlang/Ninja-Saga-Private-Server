<?php

namespace App\Services\Amf\PetService;

use App\Models\Character;
use App\Models\CharacterPet;
use App\Services\Amf\Concerns\ValidatesSession;
use Illuminate\Support\Facades\Log;

class QueryService
{
    use ValidatesSession;

    /**
     * getPets
     */
    public function getPets($params)
    {
        $guard = $this->guardCharacterSessionFromParams($params);
        if ($guard) {
            return $guard;
        }

        $charId = $params[0];
        Log::info("AMF PetService.getPets: Char $charId");

        $char = Character::find($charId);
        $pets = CharacterPet::where('character_id', $charId)->get();

        // Auto-equip if only 1 pet exists
        if ($pets->count() === 1 && $char && empty($char->equipment_pet)) {
            $char->update(['equipment_pet' => $pets->first()->id]);
            $char->equipment_pet = $pets->first()->id;
        }

        if ($char && $char->equipment_pet) {
            $pets = $pets
                ->sortByDesc(fn ($pet) => $pet->id === $char->equipment_pet)
                ->values();
        }

        $petList = [];
        foreach ($pets as $p) {
            $config = \App\Models\Pet::where('pet_id', $p->pet_id)
                ->orWhere('swf', $p->pet_id)
                ->first();
            if (!$config && is_numeric($p->pet_id)) {
                $config = \App\Models\Pet::find((int) $p->pet_id);
            }
            if (!$config && !empty($p->name)) {
                $config = \App\Models\Pet::where('name', $p->name)->first();
            }
            $resolvedSwf = ($config && !empty($config->swf))
                ? $config->swf
                : (($config && !empty($config->pet_id)) ? $config->pet_id : $p->pet_id);
            $petList[] = [
                'pet' => $p->id,
                'char_id' => $charId,
                'pet_id' => $p->id, // Instance ID for client logic
                'pet_name' => $p->name ?? ($config->name ?? 'Unknown Pet'),
                'pet_xp' => $p->xp,
                'pet_level' => $p->level,
                'pet_skills' => !empty($p->learned_skills) ? $p->learned_skills : '1,0,0,0,0,0',
                'pet_mp' => (int) $p->maturity_points,
                'pet_swf' => $resolvedSwf // Resolved SWF filename (handles legacy numeric pet_id rows like Easa)
            ];
        }

        return [
            'status' => 1,
            'pets' => $petList
        ];
    }
}
