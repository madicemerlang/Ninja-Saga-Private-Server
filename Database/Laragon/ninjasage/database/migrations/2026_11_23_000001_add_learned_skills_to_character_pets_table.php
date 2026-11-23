<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('character_pets', 'learned_skills')) {
            Schema::table('character_pets', function (Blueprint $table) {
                $table->string('learned_skills', 32)->nullable()->after('maturity_points');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('character_pets', 'learned_skills')) {
            Schema::table('character_pets', function (Blueprint $table) {
                $table->dropColumn('learned_skills');
            });
        }
    }
};
