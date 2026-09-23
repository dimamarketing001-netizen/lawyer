<?php
/**
 * Диагностика интеграции: показывает, куда пишутся логи, доступны ли они
 * для записи и отвечает ли Lead-Injector. Заявку не создаёт.
 *
 * Запуск: php api/healthcheck.php
 *   или   https://<сайт>/api/healthcheck.php?token=<CRON_SECRET>
 */

require __DIR__ . '/config.php';

if (php_sapi_name() !== 'cli'
    && !hash_equals(CRON_SECRET, (string) ($_GET['token'] ?? ''))) {
    http_response_code(403);
    die('Forbidden');
}

if (php_sapi_name() !== 'cli') {
    header('Content-Type: text/plain; charset=utf-8');
}

$storageWritable = is_dir(STORAGE_DIR) && is_writable(STORAGE_DIR);

// Пингуем Lead-Injector заведомо неверным токеном: так проверяется сеть и
// сертификат, но лид в CRM не создаётся.
$ch = curl_init(LEAD_INJECTOR_URL . '?token=healthcheck');
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => '{}',
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 10,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
]);
$ping      = curl_exec($ch);
$pingCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$pingError = curl_error($ch);
curl_close($ch);

$rows = [
    'PHP'                    => PHP_VERSION,
    'cURL'                   => function_exists('curl_init') ? 'есть' : 'НЕТ — отправка невозможна',
    'Часовой пояс'           => date_default_timezone_get() . ' (сейчас ' . date('Y-m-d H:i:s') . ')',
    'Каталог логов'          => STORAGE_DIR,
    'Каталог доступен'       => $storageWritable ? 'да' : 'НЕТ — заявки не логируются',
    'Каталог вне сайта'      => str_starts_with(STORAGE_DIR, BASE_DIR) ? 'нет — закрыт через .htaccess' : 'да',
    'leads.log'              => file_exists(LOG_FILE) ? (filesize(LOG_FILE) . ' байт, заявок: ' . count(file(LOG_FILE, FILE_SKIP_EMPTY_LINES))) : 'ещё не создан',
    'Lead-Injector'          => $pingError !== '' ? 'ОШИБКА СВЯЗИ: ' . $pingError : 'отвечает, HTTP ' . $pingCode,
];

foreach ($rows as $key => $value) {
    // str_pad считает байты, а подписи кириллические — выравниваем по символам
    echo $key . str_repeat(' ', max(1, 22 - mb_strlen($key))) . ': ' . $value . PHP_EOL;
}

$problems = !$storageWritable || !function_exists('curl_init') || $pingError !== '';
echo PHP_EOL . ($problems ? 'ЕСТЬ ПРОБЛЕМЫ — смотрите строки выше' : 'Всё в порядке') . PHP_EOL;
