CREATE USER IF NOT EXISTS 'datadog'@'%' IDENTIFIED WITH mysql_native_password by 'datadog-password';

ALTER USER 'datadog'@'%' WITH MAX_USER_CONNECTIONS 5;
GRANT REPLICATION CLIENT ON *.* TO 'datadog'@'%';
GRANT PROCESS ON *.* TO 'datadog'@'%';
