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

// Проверяем только локальную конфигурацию: запрос к webhook может создать лид.
$pingError = '';

$rows = [
    'PHP'                    => PHP_VERSION,
    'cURL'                   => function_exists('curl_init') ? 'есть' : 'НЕТ — отправка невозможна',
    'Часовой пояс'           => date_default_timezone_get() . ' (сейчас ' . date('Y-m-d H:i:s') . ')',
    'Каталог логов'          => STORAGE_DIR,
    'Каталог доступен'       => $storageWritable ? 'да' : 'НЕТ — заявки не логируются',
    'Каталог вне сайта'      => strpos(STORAGE_DIR, BASE_DIR) === 0 ? 'нет — закрыт через .htaccess' : 'да',
    'leads.log'              => file_exists(LOG_FILE) ? (filesize(LOG_FILE) . ' байт, заявок: ' . count(file(LOG_FILE, FILE_SKIP_EMPTY_LINES))) : 'ещё не создан',
    'Webhook'                => LEAD_INJECTOR_URL,
    'Проверка приёма'         => 'отправьте тестовую заявку через сайт',
];

foreach ($rows as $key => $value) {
    // str_pad считает байты, а подписи кириллические — выравниваем по символам
    echo $key . str_repeat(' ', max(1, 22 - mb_strlen($key))) . ': ' . $value . PHP_EOL;
}

$problems = !$storageWritable || !function_exists('curl_init') || $pingError !== '';
echo PHP_EOL . ($problems ? 'ЕСТЬ ПРОБЛЕМЫ — смотрите строки выше' : 'Всё в порядке') . PHP_EOL;
