<?php
/**
 * Скрипт автоматического перезапуска неудавшихся заявок в Lead-Injector.
 * Запускается по Cron каждые 10 минут.
 *
 * Читает leads.log, находит строки с injector_ok = false и отправляет их заново.
 * Уже добитые заявки помнит в retried_success.json, чтобы не слать дубли.
 */

require __DIR__ . '/config.php';

// Обычный запуск — из консоли по Cron. HTTP-запуск оставлен для хостингов
// без CLI-крона, но только с секретом: иначе кто угодно мог бы дёргать
// повторную отправку заявок.
if (php_sapi_name() !== 'cli'
    && !hash_equals(CRON_SECRET, (string) ($_GET['token'] ?? ''))) {
    http_response_code(403);
    die('Forbidden');
}

if (!file_exists(LOG_FILE)) {
    logMessage('Файл логов leads.log не найден по пути: ' . LOG_FILE);
    exit;
}

// Загружаем базу уже отправленных через retry заявок
$retriedDatabase = [];
if (file_exists(DB_FILE)) {
    $retriedDatabase = json_decode((string) file_get_contents(DB_FILE), true) ?: [];
}

$handle = fopen(LOG_FILE, 'r');
if (!$handle) {
    logMessage('Не удалось открыть файл leads.log');
    exit;
}

logMessage('=== Старт проверки зависших лидов ===');

$processedCount = 0;
$successCount   = 0;

while (($line = fgets($handle)) !== false) {
    $line = trim($line);
    if ($line === '') {
        continue;
    }

    // Парсим строку лога: [YYYY-MM-DD HH:MM:SS] {JSON}
    if (!preg_match('/^\[(.*?)\]\s+(.*)$/', $line, $matches)) {
        continue;
    }

    $timestamp = $matches[1];
    $jsonData  = json_decode($matches[2], true);

    if (!$jsonData || !is_array($jsonData)) {
        continue;
    }

    // Если интеграция прошла успешно изначально, пропускаем
    if (isset($jsonData['injector_ok']) && $jsonData['injector_ok'] === true) {
        continue;
    }

    // Уникальный ID заявки на основе времени и телефона
    $phone  = $jsonData['phone'] ?? '';
    $leadId = md5($timestamp . $phone);

    // Эту заявку уже доотправили ранее
    if (isset($retriedDatabase[$leadId])) {
        continue;
    }

    $processedCount++;
    logMessage("Найдена упавшая заявка: {$phone} от {$timestamp}. Отправляем...");

    $payload = buildPayload($jsonData);

    $result = sendToLeadInjector($payload);

    if ($result['ok']) {
        $successCount++;
        $retriedDatabase[$leadId] = [
            'phone'       => $phone,
            'time_logged' => $timestamp,
            'time_sent'   => date('Y-m-d H:i:s'),
        ];
        logMessage('Успешно отправлено! Ответ API: ' . trim($result['response']));
    } else {
        logMessage("Ошибка отправки! Код: {$result['http_code']}, Ошибка: {$result['error']}, Ответ: " . trim($result['response']));
    }
}

fclose($handle);

file_put_contents(DB_FILE, json_encode($retriedDatabase, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);

logMessage("=== Работа завершена. Найдено ошибок: {$processedCount}. Успешно доотправлено: {$successCount} ===");


/* ================== ФУНКЦИИ ================== */

function logMessage(string $message): void
{
    $logLine = '[' . date('Y-m-d H:i:s') . '] ' . $message . PHP_EOL;
    echo $logLine;
    appendLog(RETRY_LOG, $logLine);
}
