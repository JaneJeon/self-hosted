#!/bin/sh

mysqldump -u root --password=mysql-root-password --opt --verbose --all-databases > /mnt/dump/all.sql
