<?php

namespace App\Services\Amf;

use App\Models\Character;
use App\Models\Clan;
use App\Models\ClanMember;
use App\Services\Amf\Concerns\ValidatesSession;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * CrewService — Full Eloquent Clan/Crew system backed by `clans` and `clan_members`.
 */
class CrewService
{
    use ValidatesSession;

    private const CREATE_COST_GOLD = 100000;
    private const DEFAULT_MAX_MEMBERS = 20;

    // ------------------------------------------------------------------
    // Login / Init / Clan Data
    // ------------------------------------------------------------------

    public function login($charId = null, $sessionKey = null, ...$args)
    {
        return $this->getClanData($charId, $sessionKey);
    }

    public function loginToClanServer($charId = null, $sessionKey = null, ...$args)
    {
        return $this->getClanData($charId, $sessionKey);
    }

    public function loginToCrewServer($charId = null, $sessionKey = null, ...$args)
    {
        return $this->getClanData($charId, $sessionKey);
    }

    public function init($charId = null, $sessionKey = null, ...$args)
    {
        return $this->getClanData($charId, $sessionKey);
    }

    public function initialize($charId = null, $sessionKey = null, ...$args)
    {
        return $this->getClanData($charId, $sessionKey);
    }

    public function connect($charId = null, $sessionKey = null, ...$args)
    {
        return $this->getClanData($charId, $sessionKey);
    }

    public function getCrewData($charId = null, $sessionKey = null, ...$args)
    {
        return $this->getClanData($charId, $sessionKey);
    }

    public function getCrewInfo($charId = null, $sessionKey = null, ...$args)
    {
        return $this->getClanData($charId, $sessionKey);
    }

    public function getClanInfo($charId = null, $sessionKey = null, ...$args)
    {
        return $this->getClanData($charId, $sessionKey);
    }

    public function getData($charId = null, $sessionKey = null, ...$args)
    {
        return $this->getClanData($charId, $sessionKey);
    }

    public function getInfo($charId = null, $sessionKey = null, ...$args)
    {
        return $this->getClanData($charId, $sessionKey);
    }

    public function getStatus($charId = null, $sessionKey = null, ...$args)
    {
        return $this->getClanData($charId, $sessionKey);
    }

    public function getClanData($charId = null, $sessionKey = null, ...$args)
    {
        $guard = $this->guardCharacterSession((int) $charId, (string) $sessionKey);
        if ($guard) {
            return $guard;
        }

        $membership = ClanMember::with('clan')->where('character_id', (int) $charId)->first();
        if (!$membership || !$membership->clan) {
            return $this->notInCrew();
        }

        $clan = $membership->clan;
        $members = $this->formatMembers($clan->id);

        return [
            'status'      => 1,
            'error'       => 0,
            'clan_id'     => (int) $clan->id,
            'crew_id'     => (int) $clan->id,
            'clan_name'   => $clan->name,
            'crew_name'   => $clan->name,
            'role'        => $membership->role,
            'is_master'   => (int) $clan->master_id === (int) $charId,
            'clan'        => $this->formatClan($clan, count($members)),
            'crew'        => $this->formatClan($clan, count($members)),
            'members'     => $members,
        ];
    }

    // ------------------------------------------------------------------
    // List / Search
    // ------------------------------------------------------------------

    public function getAllClans($charId = null, $sessionKey = null, ...$args)
    {
        $guard = $this->guardCharacterSession((int) $charId, (string) $sessionKey);
        if ($guard) {
            return $guard;
        }

        $clans = Clan::withCount('members')
            ->orderByDesc('prestige')
            ->orderByDesc('members_count')
            ->limit(50)
            ->get()
            ->map(fn (Clan $c) => $this->formatClan($c, (int) $c->members_count))
            ->values()
            ->all();

        return ['status' => 1, 'error' => 0, 'clans' => $clans, 'crews' => $clans, 'list' => $clans];
    }

    public function getCrewList($charId = null, $sessionKey = null, ...$args)
    {
        return $this->getAllClans($charId, $sessionKey);
    }

    public function getClanList($charId = null, $sessionKey = null, ...$args)
    {
        return $this->getAllClans($charId, $sessionKey);
    }

    public function searchClan($charId = null, $sessionKey = null, $query = '')
    {
        $guard = $this->guardCharacterSession((int) $charId, (string) $sessionKey);
        if ($guard) {
            return $guard;
        }

        $q = trim((string) $query);
        $builder = Clan::withCount('members');
        if ($q !== '') {
            $builder->where('name', 'like', '%' . $q . '%');
        }

        $clans = $builder->orderByDesc('prestige')
            ->limit(50)
            ->get()
            ->map(fn (Clan $c) => $this->formatClan($c, (int) $c->members_count))
            ->values()
            ->all();

        return ['status' => 1, 'error' => 0, 'clans' => $clans, 'crews' => $clans, 'list' => $clans];
    }

    public function searchCrew($charId = null, $sessionKey = null, $query = '')
    {
        return $this->searchClan($charId, $sessionKey, $query);
    }

    // ------------------------------------------------------------------
    // Create / Join / Leave / Disband
    // ------------------------------------------------------------------

    public function createClan($charId = null, $sessionKey = null, $clanName = '')
    {
        $guard = $this->guardCharacterSession((int) $charId, (string) $sessionKey);
        if ($guard) {
            return $guard;
        }

        $name = trim((string) $clanName);
        if (mb_strlen($name) < 3 || mb_strlen($name) > 24) {
            return ['status' => 2, 'error' => 0, 'result' => 'Clan name must be between 3 and 24 characters.'];
        }

        if (ClanMember::where('character_id', (int) $charId)->exists()) {
            return ['status' => 2, 'error' => 0, 'result' => 'You are already in a clan.'];
        }

        if (Clan::where('name', $name)->exists()) {
            return ['status' => 2, 'error' => 0, 'result' => 'That clan name is already taken.'];
        }

        return DB::transaction(function () use ($charId, $name) {
            $char = Character::lockForUpdate()->find((int) $charId);
            if (!$char) {
                return ['status' => 0, 'error' => 'Character not found'];
            }
            if ((int) $char->gold < self::CREATE_COST_GOLD) {
                return ['status' => 2, 'error' => 0, 'result' => 'Not enough gold. Creating a clan costs 100,000 Gold.'];
            }

            $char->gold -= self::CREATE_COST_GOLD;
            $char->save();

            $clan = Clan::create([
                'season_id'   => 1,
                'name'        => $name,
                'master_id'   => (int) $charId,
                'prestige'    => 100,
                'max_members' => self::DEFAULT_MAX_MEMBERS,
                'gold'        => 0,
                'tokens'      => 0,
                'buildings'   => [
                    'ramen'         => 0,
                    'hot_spring'    => 0,
                    'temple'        => 0,
                    'training_hall' => 0,
                ],
                'announcement_published' => "Welcome to {$name}!",
            ]);

            ClanMember::create([
                'clan_id'      => $clan->id,
                'character_id' => (int) $charId,
                'role'         => 'master',
                'stamina'      => 5,
                'max_stamina'  => 5,
            ]);

            Log::info("CrewService.createClan: Char $charId created clan {$clan->id} ({$name})");

            return [
                'status'  => 1,
                'error'   => 0,
                'result'  => "Clan '{$name}' created!",
                'clan_id' => (int) $clan->id,
                'clan'    => $this->formatClan($clan, 1),
            ];
        });
    }

    public function createCrew($charId = null, $sessionKey = null, $clanName = '')
    {
        return $this->createClan($charId, $sessionKey, $clanName);
    }

    public function joinClan($charId = null, $sessionKey = null, $clanId = 0)
    {
        $guard = $this->guardCharacterSession((int) $charId, (string) $sessionKey);
        if ($guard) {
            return $guard;
        }

        if (ClanMember::where('character_id', (int) $charId)->exists()) {
            return ['status' => 2, 'error' => 0, 'result' => 'You are already in a clan.'];
        }

        $clan = Clan::find((int) $clanId);
        if (!$clan) {
            return ['status' => 2, 'error' => 0, 'result' => 'Clan not found.'];
        }

        $memberCount = ClanMember::where('clan_id', $clan->id)->count();
        if ($memberCount >= ($clan->max_members ?: self::DEFAULT_MAX_MEMBERS)) {
            return ['status' => 2, 'error' => 0, 'result' => 'This clan is full.'];
        }

        ClanMember::create([
            'clan_id'      => $clan->id,
            'character_id' => (int) $charId,
            'role'         => 'member',
            'stamina'      => 5,
            'max_stamina'  => 5,
        ]);

        Log::info("CrewService.joinClan: Char $charId joined clan {$clan->id}");

        return [
            'status' => 1,
            'error'  => 0,
            'result' => "Joined '{$clan->name}'!",
            'clan'   => $this->formatClan($clan, $memberCount + 1),
        ];
    }

    public function joinCrew($charId = null, $sessionKey = null, $clanId = 0)
    {
        return $this->joinClan($charId, $sessionKey, $clanId);
    }

    public function leaveClan($charId = null, $sessionKey = null, ...$args)
    {
        $guard = $this->guardCharacterSession((int) $charId, (string) $sessionKey);
        if ($guard) {
            return $guard;
        }

        $membership = ClanMember::with('clan')->where('character_id', (int) $charId)->first();
        if (!$membership) {
            return ['status' => 2, 'error' => 0, 'result' => 'You are not in a clan.'];
        }

        if ($membership->clan && (int) $membership->clan->master_id === (int) $charId) {
            $otherMembers = ClanMember::where('clan_id', $membership->clan_id)
                ->where('character_id', '!=', (int) $charId)
                ->count();
            if ($otherMembers > 0) {
                return ['status' => 2, 'error' => 0, 'result' => 'Clan Master must disband the clan or kick members first.'];
            }
            $membership->clan->delete();
        }

        $membership->delete();
        return ['status' => 1, 'error' => 0, 'result' => 'Left clan successfully.'];
    }

    public function leaveCrew($charId = null, $sessionKey = null, ...$args)
    {
        return $this->leaveClan($charId, $sessionKey);
    }

    public function disbandClan($charId = null, $sessionKey = null, ...$args)
    {
        $guard = $this->guardCharacterSession((int) $charId, (string) $sessionKey);
        if ($guard) {
            return $guard;
        }

        $clan = Clan::where('master_id', (int) $charId)->first();
        if (!$clan) {
            return ['status' => 2, 'error' => 0, 'result' => 'Only the Clan Master can disband the clan.'];
        }

        DB::transaction(function () use ($clan) {
            ClanMember::where('clan_id', $clan->id)->delete();
            $clan->delete();
        });

        return ['status' => 1, 'error' => 0, 'result' => 'Clan disbanded.'];
    }

    public function disbandCrew($charId = null, $sessionKey = null, ...$args)
    {
        return $this->disbandClan($charId, $sessionKey);
    }

    // ------------------------------------------------------------------
    // Members
    // ------------------------------------------------------------------

    public function getMembers($charId = null, $sessionKey = null, $clanId = null)
    {
        $guard = $this->guardCharacterSession((int) $charId, (string) $sessionKey);
        if ($guard) {
            return $guard;
        }

        $targetClanId = (int) $clanId;
        if ($targetClanId <= 0) {
            $membership = ClanMember::where('character_id', (int) $charId)->first();
            $targetClanId = $membership ? (int) $membership->clan_id : 0;
        }

        if ($targetClanId <= 0) {
            return ['status' => 1, 'error' => 0, 'members' => []];
        }

        return ['status' => 1, 'error' => 0, 'members' => $this->formatMembers($targetClanId)];
    }

    public function getClanMembers($charId = null, $sessionKey = null, $clanId = null)
    {
        return $this->getMembers($charId, $sessionKey, $clanId);
    }

    public function kickMember($charId = null, $sessionKey = null, $targetCharId = 0)
    {
        $guard = $this->guardCharacterSession((int) $charId, (string) $sessionKey);
        if ($guard) {
            return $guard;
        }

        $clan = Clan::where('master_id', (int) $charId)->first();
        if (!$clan) {
            return ['status' => 2, 'error' => 0, 'result' => 'Only the Clan Master can kick members.'];
        }

        if ((int) $targetCharId === (int) $charId) {
            return ['status' => 2, 'error' => 0, 'result' => 'Cannot kick yourself.'];
        }

        ClanMember::where('clan_id', $clan->id)
            ->where('character_id', (int) $targetCharId)
            ->delete();

        return ['status' => 1, 'error' => 0, 'result' => 'Member removed from clan.'];
    }

    public function promoteMember($charId = null, $sessionKey = null, ...$args)
    {
        return ['status' => 2, 'error' => 0, 'result' => 'Promotion is not available yet.'];
    }

    // ------------------------------------------------------------------
    // Leaderboard / Battle / Village
    // ------------------------------------------------------------------

    public function getLeaderboard($charId = null, $sessionKey = null, ...$args)
    {
        $guard = $this->guardCharacterSession((int) $charId, (string) $sessionKey);
        if ($guard) {
            return $guard;
        }

        $list = Clan::withCount('members')
            ->orderByDesc('prestige')
            ->orderByDesc('members_count')
            ->limit(50)
            ->get()
            ->map(fn (Clan $c) => $this->formatClan($c, (int) $c->members_count))
            ->values()
            ->all();

        return ['status' => 1, 'error' => 0, 'data' => $list, 'list' => $list];
    }

    public function getCrewBattleData($charId = null, $sessionKey = null, ...$args)
    {
        return ['status' => 1, 'error' => 0, 'data' => []];
    }

    public function getClanBattleData($charId = null, $sessionKey = null, ...$args)
    {
        return ['status' => 1, 'error' => 0, 'data' => []];
    }

    public function startBattle($charId = null, $sessionKey = null, ...$args)
    {
        return ['status' => 2, 'error' => 0, 'result' => 'Clan battle is not active right now.'];
    }

    public function finishBattle($charId = null, $sessionKey = null, ...$args)
    {
        return ['status' => 2, 'error' => 0, 'result' => 'Clan battle is not active right now.'];
    }

    public function getMiniGameData($charId = null, $sessionKey = null, ...$args)
    {
        return ['status' => 1, 'error' => 0, 'data' => []];
    }

    public function getVillageData($charId = null, $sessionKey = null, ...$args)
    {
        return $this->getClanData($charId, $sessionKey);
    }

    public function upgradeVillage($charId = null, $sessionKey = null, ...$args)
    {
        return ['status' => 2, 'error' => 0, 'result' => 'Village upgrades coming soon.'];
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private function formatClan(Clan $clan, int $memberCount): array
    {
        $master = Character::find($clan->master_id);
        return [
            'id'           => (int) $clan->id,
            'name'         => $clan->name,
            'master_id'    => (int) $clan->master_id,
            'master_name'  => $master ? $master->name : 'Unknown',
            'prestige'     => (int) $clan->prestige,
            'members'      => $memberCount,
            'max_members'  => (int) ($clan->max_members ?: self::DEFAULT_MAX_MEMBERS),
            'gold'         => (int) $clan->gold,
            'tokens'       => (int) $clan->tokens,
            'announcement' => (string) ($clan->announcement_published ?? ''),
            'buildings'    => $clan->buildings ?: $clan->getDefaultBuildings(),
        ];
    }

    private function formatMembers(int $clanId): array
    {
        return ClanMember::with('character')
            ->where('clan_id', $clanId)
            ->orderByRaw("CASE WHEN role = 'master' THEN 0 WHEN role = 'elder' THEN 1 ELSE 2 END")
            ->get()
            ->map(function (ClanMember $m) {
                $c = $m->character;
                return [
                    'char_id'        => (int) $m->character_id,
                    'name'           => $c ? $c->name : "Ninja #{$m->character_id}",
                    'level'          => $c ? (int) $c->level : 1,
                    'rank'           => $c ? (int) $c->rank : 1,
                    'role'           => $m->role,
                    'donated_golds'  => (int) $m->donated_golds,
                    'donated_tokens' => (int) $m->donated_tokens,
                ];
            })
            ->values()
            ->all();
    }

    private function notInCrew(): array
    {
        return [
            'status'    => 1,
            'error'     => 0,
            'clan'      => null,
            'crew'      => null,
            'clan_id'   => 0,
            'crew_id'   => 0,
            'clan_name' => '',
            'crew_name' => '',
            'members'   => [],
            'result'    => 'not_in_crew',
        ];
    }
}
