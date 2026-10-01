<?php
/**
 * Боевые ключи интеграции. ЭТОТ ФАЙЛ — ШАБЛОН.
 *
 * Разворачивание:
 *   1. cp api/secrets.example.php api/secrets.php
 *   2. подставить реальные значения
 *
 * api/secrets.php добавлен в .gitignore и не должен попадать в репозиторий.
 */

// Секрет для запуска retry.php и healthcheck.php по HTTP
// (если хостинг не умеет CLI-крон). Длинная случайная строка.
const CRON_SECRET = '';
