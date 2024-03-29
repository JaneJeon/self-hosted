#!/bin/bash

if [ -n "$(git status --porcelain --ignore-submodules=dirty)" ]; then
    echo "There are uncommitted changes in working tree after execution of the build"
    echo "Please run the build locally and commit changes"
    exit 1
else
    echo "Git working tree is clean"
fi
