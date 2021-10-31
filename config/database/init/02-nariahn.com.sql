CREATE DATABASE IF NOT EXISTS portfolio;

CREATE USER IF NOT EXISTS 'ghost-portfolio'@'%' IDENTIFIED WITH mysql_native_password BY 'ghost-portfolio-password';
GRANT ALL PRIVILEGES ON portfolio.* TO 'ghost-portfolio'@'%';
