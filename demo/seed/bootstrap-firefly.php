<?php
/**
 * Create the integration user and personal access token inside the Firefly container.
 * Production Firefly images omit `php artisan tinker`, so we bootstrap Laravel directly.
 *
 * Usage (inside container):
 *   php /tmp/bootstrap-firefly.php email password "Token name"
 * Prints the access token to stdout.
 */
declare(strict_types=1);

if ($argc < 4) {
    fwrite(STDERR, "Usage: php bootstrap-firefly.php email password token_name\n");
    exit(1);
}

[, $email, $password, $tokenName] = $argv;

chdir('/var/www/html');
require '/var/www/html/vendor/autoload.php';

$app = require '/var/www/html/bootstrap/app.php';
/** @var \Illuminate\Contracts\Console\Kernel $kernel */
$kernel = $app->make(\Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use FireflyIII\Console\Commands\Correction\CreatesGroupMemberships;
use FireflyIII\Repositories\User\UserRepositoryInterface;
use FireflyIII\User;
use Illuminate\Support\Facades\Hash;

$user = User::where('email', $email)->first();
if ($user === null) {
    if (User::count() === 0) {
        $repository = app(UserRepositoryInterface::class);
        $user = $repository->store([
            'blocked' => false,
            'blocked_code' => null,
            'email' => $email,
            'role' => 'owner',
        ]);
        $user->password = Hash::make($password);
        $user->save();
    } else {
        $user = User::query()->orderBy('id')->first();
    }
}

if ($user === null) {
    fwrite(STDERR, "No Firefly user available.\n");
    exit(1);
}

CreatesGroupMemberships::createGroupMembership($user);
$user->refresh();

if (!method_exists($user, 'createToken')) {
    fwrite(STDERR, "User model does not support createToken().\n");
    exit(1);
}

echo $user->createToken($tokenName)->accessToken;
