<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClanSeason;
use App\Models\CrewSeason;
use App\Models\ShadowWarSeason;
use App\Models\User;
use App\Services\Amf\SystemLoginService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class MobileAuthController extends Controller
{
    public function login(Request $request, SystemLoginService $loginService): JsonResponse
    {
        $validated = $request->validate([
            'username' => ['required', 'string'],
            'password' => ['required', 'string'],
        ]);

        $user = User::where('username', $validated['username'])->first();

        if (!$user || !Hash::check($validated['password'], $user->password)) {
            return response()->json([
                'status' => 0,
                'error' => 'Invalid username or password',
            ], 401);
        }

        $sessionKey = bin2hex(random_bytes(16));
        $user->session_key = $sessionKey;
        $user->save();

        $characters = $loginService->getAllCharacters($user->id, $sessionKey);

        return response()->json([
            'status' => 1,
            'uid' => $user->id,
            'username' => $user->username,
            'account_type' => (int) ($user->account_type ?? 0),
            'sessionkey' => $sessionKey,
            'characters' => $characters,
            'seasons' => [
                'clan' => $this->latestSeason(ClanSeason::class, 'number'),
                'crew' => $this->latestSeason(CrewSeason::class, 'number'),
                'shadow_war' => $this->latestSeason(ShadowWarSeason::class, 'num'),
            ],
            'sockets' => [
                'pvp' => env('PVP_SOCKET_URL', 'http://127.0.0.1:3000/pvp'),
                'chat' => env('CHAT_SOCKET_URL', 'http://127.0.0.1:3002'),
            ],
            'server_time' => time(),
        ]);
    }

    public function register(Request $request, SystemLoginService $loginService): JsonResponse
    {
        $validated = $request->validate([
            'username' => ['required', 'string', 'min:3', 'max:32'],
            'email' => ['required', 'email'],
            'password' => ['required', 'string', 'min:4'],
        ]);

        $result = $loginService->registerUser(
            $validated['username'],
            $validated['email'],
            $validated['password'],
            'mobile'
        );

        $ok = is_array($result) && (($result['status'] ?? 0) === 1);

        return response()->json($result, $ok ? 201 : 422);
    }

    private function latestSeason(string $modelClass, string $column): string
    {
        try {
            $season = $modelClass::where('active', true)->latest($column)->first();
            return $season ? (string) $season->{$column} : '1';
        } catch (\Throwable) {
            return '1';
        }
    }
}
