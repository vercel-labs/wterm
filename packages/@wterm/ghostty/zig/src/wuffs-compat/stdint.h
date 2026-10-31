#ifndef WTERM_WUFFS_STDINT_H
#define WTERM_WUFFS_STDINT_H
typedef signed char int8_t;
typedef unsigned char uint8_t;
typedef short int16_t;
typedef unsigned short uint16_t;
typedef int int32_t;
typedef unsigned int uint32_t;
typedef long long int64_t;
typedef unsigned long long uint64_t;
typedef unsigned long uintptr_t;
typedef long intptr_t;
#define SIZE_MAX ((size_t)-1)
#define UINT64_MAX ((uint64_t)-1)
#define INT64_MIN (-((int64_t)UINT64_MAX / 2) - 1)
#endif
