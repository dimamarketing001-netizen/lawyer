<?php
/**
 * Общие настройки интеграции с Lead-Injector.
 * Подключается и из submit.php, и из retry.php, чтобы токен и тип лида
 * лежали в одном месте.
 */

// Ключи лежат в api/secrets.php — он не попадает в репозиторий.
// Разверните из api/secrets.example.php и заполните своими значениями.
$secretsFile = __DIR__ . '/secrets.php';
if (!is_file($secretsFile)) {
    error_log('[lead-integration] Нет api/secrets.php — скопируйте api/secrets.example.php и заполните ключи.');
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'server_misconfigured'], JSON_UNESCAPED_UNICODE);
    exit;
}
require $secretsFile;

// Интеграция
const LEAD_INJECTOR_URL = 'https://xn--b1ajdba5acbodeeeaj1qb.xn--p1ai/tilda_webhook?type_id=72&source_id=UC_11UXNN';

// Домен-источник, если не удалось определить из запроса
const DOMAIN_FALLBACK = 'xn--h1apee0d.xn--b1ajdba5acbodeeeaj1qb.xn--p1ai'; // юрист.союзюристовроссии.рф

// Часовой пояс для меток времени в логах (по умолчанию PHP считает время в UTC)
const LOG_TIMEZONE = 'Europe/Moscow';

date_default_timezone_set(LOG_TIMEZONE);

// Пути
define('BASE_DIR',    __DIR__);
define('STORAGE_DIR', resolveStorageDir());
define('LOG_FILE',    STORAGE_DIR . '/leads.log');
define('DB_FILE',     STORAGE_DIR . '/retried_success.json');
define('RETRY_LOG',   STORAGE_DIR . '/retry.log');

/**
 * Каталог для логов. В логах лежат персональные данные (имя, телефон,
 * описание проблемы), поэтому сначала пробуем положить их рядом с корнем
 * сайта — туда, куда нет доступа из браузера. Если каталог создать нельзя
 * (например, права только внутри сайта), откатываемся на api/storage и
 * закрываем его через .htaccess.
 */
function resolveStorageDir(): string
{
    $outside = dirname(__DIR__, 2) . '/storage-moy-yurist';
    if (is_dir($outside) ? is_writable($outside) : @mkdir($outside, 0750, true)) {
        return $outside;
    }

    $inside = __DIR__ . '/storage';
    if (!is_dir($inside)) {
        @mkdir($inside, 0750, true);
    }
    if (!file_exists($inside . '/.htaccess')) {
        @file_put_contents($inside . '/.htaccess', "Require all denied\nDeny from all\n");
    }

    return $inside;
}

/**
 * Запись строки в лог. В отличие от простого @file_put_contents сообщает
 * о проблеме в лог PHP — иначе заявки молча теряются, а причину
 * (нет прав на каталог) увидеть неоткуда.
 */
function appendLog(string $file, string $line): bool
{
    $ok = @file_put_contents($file, $line, FILE_APPEND | LOCK_EX);

    if ($ok === false) {
        error_log('[lead-integration] Не удалось записать лог: ' . $file
            . ' (каталог ' . dirname($file) . ' недоступен для записи)');
        return false;
    }

    return true;
}

/**
 * Отправка заявки в Lead-Injector.
 * type_id и source_id заданы в URL, тело — форма Tilda.
 */
function sendToLeadInjector(array $payload): array
{
    $fullUrl = LEAD_INJECTOR_URL;

    $ch = curl_init($fullUrl);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => http_build_query($payload),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/x-www-form-urlencoded',
            'Accept: application/json',
        ],
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error    = curl_error($ch);
    curl_close($ch);

    return [
        'ok'        => ($httpCode >= 200 && $httpCode < 300),
        'http_code' => $httpCode,
        'response'  => $response ?: '',
        'error'     => $error ?: '',
    ];
}

/**
 * Сборка payload в формате Lead-Injector.
 * Тип и источник заданы в URL webhook. Выбранная ситуация уходит в поле 0__ без префикса в тексте.
 */
function buildPayload(array $data): array
{
    $utm = is_array($data['utm'] ?? null) ? $data['utm'] : [];

    $payload = [
        'Name'             => $data['name'] ?? '',
        'Phone'            => $data['phone'] ?? '',
        'city'             => $data['city'] ?? '',
        'region'           => $data['region'] ?? '',
        '0__'              => trim((string) ($data['topic'] ?? '')) ?: 'Другое',
        'source'           => $data['source'] ?? DOMAIN_FALLBACK,
        'quality'          => $data['quality'] ?? 'good',
        'score'            => (int) ($data['score'] ?? 0),
        'yandex_client_id' => $data['yandex_client_id'] ?? '',
        'ym_uid'           => $data['cookies']['_ym_uid'] ?? '',
        'ip'               => $data['ip'] ?? '127.0.0.1',
    ];

    foreach ($utm as $key => $value) {
        $payload[$key] = $value;
    }

    return $payload;
}
