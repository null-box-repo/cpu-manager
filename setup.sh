#!/bin/sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}[1/5] Updating packages...${NC}"
apk update && echo -e "${GREEN}[1/5] Update complete${NC}"

echo -e "${BLUE}[2/5] Upgrading packages...${NC}"
apk upgrade && echo -e "${GREEN}[2/5] Upgrade complete${NC}"

echo -e "${BLUE}[3/5] Checking nodejs...${NC}"
if command -v node &> /dev/null; then
    echo -e "${GREEN}[3/5] nodejs is already installed${NC}"
else
    echo -e "${YELLOW}[3/5] nodejs not found${NC}"
    echo -e "${BLUE}[3/5] Installing nodejs...${NC}"
    apk add nodejs && echo -e "${GREEN}[3/5] nodejs installed successfully${NC}"
fi

echo -e "${BLUE}[4/5] Checking gcc...${NC}"
if command -v gcc &> /dev/null; then
    echo -e "${GREEN}[4/5] gcc is already installed${NC}"
else
    echo -e "${YELLOW}[4/5] gcc not found${NC}"
    echo -e "${BLUE}[4/5] Installing gcc...${NC}"
    apk add gcc && echo -e "${GREEN}[4/5] gcc installed successfully${NC}"
fi

echo -e "${BLUE}[5/5] Building cpuset...${NC}"
gcc -O2 -o cpuset c/cpuset.c && echo -e "${GREEN}[5/5] cpuset built successfully${NC}"

echo -e "${GREEN}All done.${NC}"