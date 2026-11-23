<?php

use App\Http\Controllers\Api\MobileAuthController;
use App\Http\Controllers\Api\MobileGameController;
use App\Http\Controllers\Api\SwfAssetController;
use App\Http\Middleware\MobileCorsMiddleware;
use Illuminate\Support\Facades\Route;

Route::middleware([MobileCorsMiddleware::class])->group(function () {
    Route::prefix('v1')->group(function () {
        Route::get('/health', [MobileGameController::class, 'health']);

        Route::post('/auth/login', [MobileAuthController::class, 'login']);
        Route::post('/auth/register', [MobileAuthController::class, 'register']);

        Route::get('/characters', [MobileGameController::class, 'characters']);
        Route::post('/characters', [MobileGameController::class, 'characterCreate']);
        Route::get('/characters/{id}', [MobileGameController::class, 'characterShow'])
            ->whereNumber('id');

        Route::post('/battle/start', [MobileGameController::class, 'battleStart']);
        Route::post('/battle/finish', [MobileGameController::class, 'battleFinish']);
        Route::get('/feature-data', [MobileGameController::class, 'featureData']);

        Route::post('/rpc/{service}/{method}', [MobileGameController::class, 'rpc']);

        Route::get('/assets/catalog', [SwfAssetController::class, 'catalog']);
        Route::get('/assets/battle/{charId}/{enemyId}.swf', [SwfAssetController::class, 'battle'])
            ->whereNumber('charId');
        Route::get('/assets/player/{charId}.swf', [SwfAssetController::class, 'player'])
            ->whereNumber('charId');
        Route::get('/assets/player/{charId}/skill/{skillId}.swf', [SwfAssetController::class, 'playerSkill'])
            ->whereNumber('charId');
        Route::get('/assets/swf/{category}', [SwfAssetController::class, 'index']);
        Route::get('/assets/swf/{category}/{filename}', [SwfAssetController::class, 'show'])
            ->where('filename', '[a-zA-Z0-9._-]+\.swf');
    });
});
