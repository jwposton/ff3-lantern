<?php
/**
 * Bootstrap Firefly for the public demo: service user (owner + PAT) and browser demo user.
 *
 * Usage (inside container):
 *   php bootstrap-demo-firefly.php service_email service_password demo_email demo_password "Token name"
 * Prints the service user's access token to stdout.
 */
declare(strict_types=1);

if ($argc < 6) {
    fwrite(STDERR, "Usage: php bootstrap-demo-firefly.php service_email service_password demo_email demo_password token_name\n");
    exit(1);
}

[, $serviceEmail, $servicePassword, $demoEmail, $demoPassword, $tokenName] = $argv;

chdir('/var/www/html');
require '/var/www/html/vendor/autoload.php';

$app = require '/var/www/html/bootstrap/app.php';
/** @var \Illuminate\Contracts\Console\Kernel $kernel */
$kernel = $app->make(\Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use FireflyIII\Console\Commands\Correction\CreatesGroupMemberships;
use FireflyIII\Enums\UserRoleEnum;
use FireflyIII\Models\GroupMembership;
use FireflyIII\Models\UserRole;
use FireflyIII\Repositories\User\UserRepositoryInterface;
use FireflyIII\User;
use Illuminate\Support\Facades\Hash;

/** @var UserRepositoryInterface $repository */
$repository = app(UserRepositoryInterface::class);

$serviceUser = User::where('email', $serviceEmail)->first();
if ($serviceUser === null) {
    if (User::count() !== 0) {
        fwrite(STDERR, "Service user {$serviceEmail} not found and Firefly DB is not empty.\n");
        fwrite(STDERR, "Use --reset or recreate the database before bootstrapping.\n");
        exit(1);
    }

    $serviceUser = $repository->store([
        'blocked' => false,
        'blocked_code' => null,
        'email' => $serviceEmail,
        'role' => 'owner',
    ]);
    $serviceUser->password = Hash::make($servicePassword);
    $serviceUser->save();

    CreatesGroupMemberships::createGroupMembership($serviceUser);
    $serviceUser->refresh();
}

if ($serviceUser->user_group_id === null) {
    CreatesGroupMemberships::createGroupMembership($serviceUser);
    $serviceUser->refresh();
}

$serviceGroupId = (int) $serviceUser->user_group_id;
if ($serviceGroupId === 0) {
    fwrite(STDERR, "Service user has no user_group_id.\n");
    exit(1);
}

$demoUser = User::where('email', $demoEmail)->first();
if ($demoUser === null) {
    $demoUser = $repository->store([
        'blocked' => false,
        'blocked_code' => null,
        'email' => $demoEmail,
        'role' => 'demo',
    ]);
    $demoUser->password = Hash::make($demoPassword);
    $demoUser->save();
}

$txnRole = UserRole::query()->where('title', UserRoleEnum::MANAGE_TRANSACTIONS->value)->first();
if ($txnRole === null) {
    fwrite(STDERR, "Firefly user role mng_trx not found; run migrations first.\n");
    exit(1);
}

$membership = GroupMembership::query()
    ->where('user_id', $demoUser->id)
    ->where('user_group_id', $serviceGroupId)
    ->where('user_role_id', $txnRole->id)
    ->first();

if ($membership === null) {
    GroupMembership::create([
        'user_id' => $demoUser->id,
        'user_role_id' => $txnRole->id,
        'user_group_id' => $serviceGroupId,
    ]);
}

if ((int) $demoUser->user_group_id !== $serviceGroupId) {
    $demoUser->user_group_id = $serviceGroupId;
    $demoUser->save();
}

if (!method_exists($serviceUser, 'createToken')) {
    fwrite(STDERR, "User model does not support createToken().\n");
    exit(1);
}

echo $serviceUser->createToken($tokenName)->accessToken;
