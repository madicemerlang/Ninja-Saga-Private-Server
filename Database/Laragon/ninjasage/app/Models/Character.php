<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Character extends Model
{
    use HasFactory;

    public const RANK_GENIN = 1;
    public const RANK_CHUNIN = 3;
    public const RANK_JOUNIN = 5;
    public const RANK_SPECIAL_JOUNIN = 7;
    public const RANK_SANNIN = 8;
    public const RANK_KAGE = 10;

    protected $fillable = [
        'user_id',
        'name',
        'level',
        'xp',
        'gender',
        'hair_style',
        'hair_color',
        'skin_color',
        'equipment_weapon',
        'equipment_back',
        'equipment_clothing',
        'equipment_accessory',
        'equipment_skills',
        'equipment_pet',
        'rank',
        'class',
        'gold',
        'claimed_welcome_rewards',
        'point_wind',
        'point_fire',
        'point_lightning',
        'point_water',
        'point_earth',
        'point_free',
        'tp',
        'ss',
        'talent_skills',
        'senjutsu_skills',
        'senjutsu_type',
        'senjutsu_equipped_skills',
        'prestige',
        'element_1',
        'element_2',
        'element_3',
        'talent_1',
        'talent_2',
        'talent_3',
        'daily_token_claimed_at',
        'daily_xp_claimed_at',
        'daily_scroll_claimed_at',
        'double_xp_expire_at',
        'xp_bonus_rate',
        'daily_scratch_date',
        'daily_scratch_consecutive',
        'daily_scratch_count',
        'scratch_grand_progress',
        'scratch_rare_progress',
        'daily_roulette_date',
        'daily_roulette_consecutive',
        'daily_roulette_count',
        'attendance_days',
        'attendance_rewards',
        'attendance_last_reset',
        'hunting_house_tries',
        'hunting_house_date',
        'eudemon_garden_tries',
        'eudemon_garden_date',
        'recruitable',
        'chunin_exam_progress',
        'chunin_claimed',
        'jounin_exam_progress',
        'jounin_claimed',
        'special_jounin_exam_progress',
        'special_jounin_claimed',
        'ninja_tutor_exam_progress',
        'ninja_tutor_claimed',
        'pvp_played',
        'pvp_won',
        'pvp_lost',
        'pvp_points',
        'pvp_trophy',
        'pet_boost_expires_at',
        'ss',
    ];

    protected $casts = [
        'attendance_days' => 'array',
        'attendance_rewards' => 'array',
        'rank' => 'integer',
        'chunin_claimed' => 'boolean',
        'jounin_claimed' => 'boolean',
        'special_jounin_claimed' => 'boolean',
        'ninja_tutor_claimed' => 'boolean',
        'recruitable' => 'boolean',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function skillSets()
    {
        return $this->hasMany(CharacterSkillSet::class);
    }

    public function items()
    {
        return $this->hasMany(CharacterItem::class);
    }

    public function skills()
    {
        return $this->hasMany(CharacterSkill::class);
    }

    public function pets()
    {
        return $this->hasMany(CharacterPet::class);
    }

    /**
     * Get max level for current rank (strictly enforces Exam caps at Lv.20, 40, 60, and 80).
     */
    public function getMaxLevel(): int
    {
        $rank = (int) $this->rank;
        if ($rank < self::RANK_CHUNIN) {
            return 20;
        }
        if ($rank < self::RANK_JOUNIN) {
            return 40;
        }
        if ($rank < self::RANK_SPECIAL_JOUNIN) {
            return 60;
        }
        if ($rank < self::RANK_SANNIN) {
            return 80;
        }
        return 85;
    }

    /**
     * Returns the required Headquarter Exam name blocking further level-ups, or null if uncapped.
     */
    public function getNextExamName(): ?string
    {
        $rank = (int) $this->rank;
        if ($rank < self::RANK_CHUNIN) {
            return 'Chunin Exam';
        }
        if ($rank < self::RANK_JOUNIN) {
            return 'Jounin Exam';
        }
        if ($rank < self::RANK_SPECIAL_JOUNIN) {
            return 'Special Jounin Exam';
        }
        if ($rank < self::RANK_SANNIN) {
            return 'Ninja Tutor Exam';
        }
        return null;
    }

    /**
     * Check if character is at level cap for their rank.
     */
    public function isLevelCapped(): bool
    {
        return (int) $this->level >= $this->getMaxLevel();
    }

    /**
     * Add XP and handle leveling up with rank caps (Lv.20 / 40 / 60 / 80 require clearing Exam).
     * Returns true if level up occurred.
     */
    public function addXp(int $amount): bool
    {
        $this->level = (int) $this->level;
        $this->xp = (int) $this->xp + $amount;
        $levelUp = false;
        $maxLevel = $this->getMaxLevel();

        while ($this->level < $maxLevel) {
            $xpReq = XP::where('level', $this->level)->value('character_xp');
            $required = $xpReq ?: 999999999;

            if ($this->xp >= $required) {
                $this->level++;
                $this->point_free = (int) $this->point_free + 1;
                $levelUp = true;
            } else {
                break;
            }
        }

        // If at rank exam cap (Lv.20/40/60/80), block further level-up & clamp XP until Exam is cleared
        if ($this->level >= $maxLevel) {
            $xpReq = XP::where('level', $this->level)->value('character_xp');
            if ($xpReq && $this->xp > $xpReq) {
                $this->xp = $xpReq;
            }
        }

        $this->save();
        return $levelUp;
    }
}
