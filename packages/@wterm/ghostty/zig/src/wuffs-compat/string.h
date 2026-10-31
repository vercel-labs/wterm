#ifndef WTERM_WUFFS_STRING_H
#define WTERM_WUFFS_STRING_H
#include <stddef.h>
void *memcpy(void *destination, const void *source, size_t length);
void *memmove(void *destination, const void *source, size_t length);
void *memset(void *destination, int value, size_t length);
int memcmp(const void *left, const void *right, size_t length);
int strcmp(const char *left, const char *right);
#endif
