#!/bin/sh

mysql -u root --password=mysql-root-password < /mnt/dump/all.sql
