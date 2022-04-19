#!/bin/sh

mysqldump -h mysql -u root --password=mysql-root-password --opt --verbose --all-databases > /mnt/dump/all.sql
