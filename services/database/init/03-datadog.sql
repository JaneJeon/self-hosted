CREATE USER IF NOT EXISTS 'datadog'@'%' IDENTIFIED WITH caching_sha2_password by 'datadog-password';

ALTER USER 'datadog'@'%' WITH MAX_USER_CONNECTIONS 5;
GRANT REPLICATION CLIENT ON *.* TO 'datadog'@'%';
GRANT PROCESS ON *.* TO 'datadog'@'%';
GRANT SELECT ON performance_schema.* TO 'datadog'@'%';
