#!/bin/sh

echo 'Restoring MySQL database...'
mysql -h mysql -u root --password=mysql-root-password < /mnt/dump/all.sql
