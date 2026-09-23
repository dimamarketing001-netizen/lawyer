<?php
/**
 * Приём заявок из чата на сайте и отправка в Lead-Injector.
 *
 * Каждая заявка пишется в leads.log строкой вида:
 *   [YYYY-MM-DD HH:MM:SS] {JSON}
 * с флагом injector_ok. Упавшие заявки потом добирает retry.php по Cron.
 */

require __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'method_not_allowed']);
    exit;
}

// Ограничение размера тела — защита от мусорных запросов
$raw = file_get_contents('php://input', false, null, 0, 32768);
$input = json_decode((string) $raw, true);

if (!is_array($input)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'bad_json']);
    exit;
}

$phone = normalizePhone(clean($input['phone'] ?? '', 30));

if ($phone === '') {
    http_response_code(422);
    echo json_encode(['ok' => false, 'error' => 'phone_required']);
    exit;
}

$campaign = is_array($input['campaign'] ?? null) ? $input['campaign'] : [];

$utm = [];
foreach (['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'yclid', 'gclid'] as $key) {
    $value = clean($campaign[$key] ?? '', 200);
    if ($value !== '') {
        $utm[$key] = $value;
    }
}

$details = clean($input['details'] ?? '', 2000);
$topic   = clean($input['topic'] ?? '', 150);

$data = [
    'name'             => clean($input['name'] ?? '', 100),
    'phone'            => $phone,
    'city'             => '',
    'region'           => '',
    'topic'            => $topic,
    'details'          => $details,
    'deadline'         => clean($input['deadline'] ?? '', 30),
    'page'             => clean($input['page'] ?? '', 500),
    'utm'              => $utm,
    'yandex_client_id' => clean($input['yandex_client_id'] ?? '', 100),
    'cookies'          => ['_ym_uid' => clean($_COOKIE['_ym_uid'] ?? '', 100)],
    'user_agent'       => clean($_SERVER['HTTP_USER_AGENT'] ?? '', 300),
    'ip'               => clientIp(),
    'source'           => currentDomain(),
];

// Оценка заполненности: описание и указанная дата — признак тёплого лида
$data['score']   = ($details !== '' ? 1 : 0) + ($data['deadline'] !== '' ? 1 : 0) + ($topic !== '' ? 1 : 0);
$data['quality'] = $data['score'] >= 2 ? 'good' : 'normal';

$result = sendToLeadInjector(buildPayload($data));

$data['injector_ok']       = $result['ok'];
$data['injector_response'] = mb_substr(trim($result['response']), 0, 500);

$logged = writeLeadLog($data);

// Лог — единственная страховка для упавших заявок: из него их добирает
// retry.php. Если записать не удалось и в Lead-Injector заявка тоже не ушла,
// она потеряна безвозвратно — такое должно быть видно в логе ошибок PHP.
if (!$logged && !$result['ok']) {
    error_log('[lead-integration] ЗАЯВКА ПОТЕРЯНА: ' . $data['phone']
        . ' — Lead-Injector вернул ' . $result['http_code'] . ', лог не записан');
}

// Для посетителя заявка принята в любом случае: если Lead-Injector не ответил,
// её доберёт retry.php. Иначе человек уйдёт, решив, что ничего не отправилось.
http_response_code($result['ok'] ? 200 : 202);
echo json_encode(['ok' => true, 'queued' => !$result['ok']], JSON_UNESCAPED_UNICODE);


/* ================== ФУНКЦИИ ================== */

function clean($value, int $limit): string
{
    if (!is_scalar($value)) {
        return '';
    }
    $value = trim((string) $value);
    $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', $value) ?? '';
    return mb_substr($value, 0, $limit);
}

/** Приводим номер к +7XXXXXXXXXX. */
function normalizePhone(string $phone): string
{
    $digits = preg_replace('/\D+/', '', $phone) ?? '';

    if ($digits === '') {
        return '';
    }
    if (strlen($digits) === 11 && $digits[0] === '8') {
        $digits = '7' . substr($digits, 1);
    }
    if (strlen($digits) === 10) {
        $digits = '7' . $digits;
    }
    if (strlen($digits) < 11) {
        return '';
    }

    return '+' . $digits;
}

function clientIp(): string
{
    return (string) ($_SERVER['REMOTE_ADDR'] ?? '127.0.0.1');
}

function currentDomain(): string
{
    $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
    $host = preg_replace('/:\d+$/', '', $host) ?? '';
    return $host !== '' ? $host : DOMAIN_FALLBACK;
}

function writeLeadLog(array $data): bool
{
    $line = '[' . date('Y-m-d H:i:s') . '] ' . json_encode($data, JSON_UNESCAPED_UNICODE) . PHP_EOL;
    return appendLog(LOG_FILE, $line);
}
