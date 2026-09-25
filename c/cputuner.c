/*
 * cputuner.c - per-cluster CPU governor/frequency control for Android.
 * Requires root. Clusters are detected via related_cpus; cores in a
 * cluster share one clock, so tuning is applied per cluster.
 *
 *   ./cputuner --list clusters
 *   ./cputuner --set governor <name>   [--cluster N]
 *   ./cputuner --set min_freq <khz>    [--cluster N]
 *   ./cputuner --set max_freq <khz>    [--cluster N]
 *
 *   ./cputuner --list gpu_governor
 *   ./cputuner --list gpu_freq
 *   ./cputuner --set gpu_governor <name>
 *   ./cputuner --set gpu_min_freq <hz>
 *   ./cputuner --set gpu_max_freq <hz>
 *
 * No --cluster: applies to all clusters.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <dirent.h>
#include <unistd.h>

#define CPU_SYS_PATH "/sys/devices/system/cpu"
#define DEVFREQ_PATH "/sys/class/devfreq"
#define MAX_LINE 512
#define MAX_CORES 64
#define ALL (-1)
#define NONE (-999999)

typedef struct {
    int cores[MAX_CORES];
    int count;
} cluster_t;

static int get_cpu_count(void) {
    DIR *dir = opendir(CPU_SYS_PATH);
    if (!dir) return 0;
    struct dirent *entry;
    int count = 0;
    while ((entry = readdir(dir)) != NULL) {
        int idx;
        if (sscanf(entry->d_name, "cpu%d", &idx) == 1) {
            char path[256];
            snprintf(path, sizeof(path), "%s/cpu%d/cpufreq", CPU_SYS_PATH, idx);
            if (access(path, F_OK) == 0 && idx + 1 > count) count = idx + 1;
        }
    }
    closedir(dir);
    return count;
}

static int read_file(const char *path, char *buf, size_t size) {
    FILE *f = fopen(path, "r");
    if (!f) return -1;
    if (!fgets(buf, size, f)) { fclose(f); return -1; }
    fclose(f);
    buf[strcspn(buf, "\n")] = 0;
    return 0;
}

static int write_file(const char *path, const char *value) {
    FILE *f = fopen(path, "w");
    if (!f) {
        fprintf(stderr, "error: cannot write to %s (are you root?)\n", path);
        return -1;
    }
    fprintf(f, "%s", value);
    fclose(f);
    return 0;
}

/* ================= Clusters ================= */

static int get_related_cpus(int core, int *out, int max) {
    char path[256], buf[MAX_LINE];
    snprintf(path, sizeof(path), "%s/cpu%d/cpufreq/related_cpus", CPU_SYS_PATH, core);
    if (read_file(path, buf, sizeof(buf)) != 0) {
        out[0] = core;
        return 1;
    }
    int n = 0;
    char *tok = strtok(buf, " ");
    while (tok && n < max) {
        out[n++] = atoi(tok);
        tok = strtok(NULL, " ");
    }
    if (n == 0) { out[0] = core; n = 1; }
    return n;
}

static int get_clusters(cluster_t *clusters, int max_clusters) {
    int cpus = get_cpu_count();
    int visited[MAX_CORES] = {0};
    int nclusters = 0;

    for (int i = 0; i < cpus && i < MAX_CORES; i++) {
        if (visited[i]) continue;
        if (nclusters >= max_clusters) break;

        int related[MAX_CORES];
        int n = get_related_cpus(i, related, MAX_CORES);

        cluster_t *c = &clusters[nclusters];
        c->count = 0;
        for (int j = 0; j < n; j++) {
            int cpu = related[j];
            if (cpu >= 0 && cpu < MAX_CORES && !visited[cpu]) {
                visited[cpu] = 1;
                c->cores[c->count++] = cpu;
            }
        }
        nclusters++;
    }
    return nclusters;
}

static void list_clusters(void) {
    cluster_t clusters[MAX_CORES];
    int n = get_clusters(clusters, MAX_CORES);

    for (int i = 0; i < n; i++) {
        int first = clusters[i].cores[0];
        printf("cluster%d: cores", i);
        for (int j = 0; j < clusters[i].count; j++) printf(" cpu%d", clusters[i].cores[j]);
        printf("\n");

        char path[256], buf[MAX_LINE];
        snprintf(path, sizeof(path), "%s/cpu%d/cpufreq/scaling_available_governors", CPU_SYS_PATH, first);
        if (read_file(path, buf, sizeof(buf)) == 0) printf("  available governors: %s\n", buf);
        snprintf(path, sizeof(path), "%s/cpu%d/cpufreq/scaling_governor", CPU_SYS_PATH, first);
        if (read_file(path, buf, sizeof(buf)) == 0) printf("  governor: %s\n", buf);
        snprintf(path, sizeof(path), "%s/cpu%d/cpufreq/scaling_available_frequencies", CPU_SYS_PATH, first);
        if (read_file(path, buf, sizeof(buf)) == 0) printf("  available frequencies (kHz): %s\n", buf);
        snprintf(path, sizeof(path), "%s/cpu%d/cpufreq/cpuinfo_min_freq", CPU_SYS_PATH, first);
        if (read_file(path, buf, sizeof(buf)) == 0) printf("  range min: %s kHz\n", buf);
        snprintf(path, sizeof(path), "%s/cpu%d/cpufreq/cpuinfo_max_freq", CPU_SYS_PATH, first);
        if (read_file(path, buf, sizeof(buf)) == 0) printf("  range max: %s kHz\n", buf);
        snprintf(path, sizeof(path), "%s/cpu%d/cpufreq/scaling_min_freq", CPU_SYS_PATH, first);
        if (read_file(path, buf, sizeof(buf)) == 0) printf("  min: %s kHz\n", buf);
        snprintf(path, sizeof(path), "%s/cpu%d/cpufreq/scaling_max_freq", CPU_SYS_PATH, first);
        if (read_file(path, buf, sizeof(buf)) == 0) printf("  max: %s kHz\n", buf);
        snprintf(path, sizeof(path), "%s/cpu%d/cpufreq/scaling_cur_freq", CPU_SYS_PATH, first);
        if (read_file(path, buf, sizeof(buf)) == 0) printf("  cur: %s kHz\n", buf);
    }
}

static int resolve_clusters(cluster_t *clusters, int max_clusters) {
    int n = get_clusters(clusters, max_clusters);
    if (n == 0) fprintf(stderr, "no cpu cores found\n");
    return n;
}

static int set_governor(int cluster_idx, const char *governor) {
    cluster_t clusters[MAX_CORES];
    int n = resolve_clusters(clusters, MAX_CORES);
    if (n == 0) return -1;
    int start = cluster_idx == ALL ? 0 : cluster_idx;
    int end = cluster_idx == ALL ? n : cluster_idx + 1;
    if (cluster_idx != ALL && (cluster_idx < 0 || cluster_idx >= n)) {
        fprintf(stderr, "invalid cluster: %d (available 0-%d)\n", cluster_idx, n - 1);
        return -1;
    }
    int ok = 1;
    for (int i = start; i < end; i++) {
        for (int j = 0; j < clusters[i].count; j++) {
            int cpu = clusters[i].cores[j];
            char path[256];
            snprintf(path, sizeof(path), "%s/cpu%d/cpufreq/scaling_governor", CPU_SYS_PATH, cpu);
            if (write_file(path, governor) == 0)
                printf("cluster%d/cpu%d -> governor: %s\n", i, cpu, governor);
            else
                ok = 0;
        }
    }
    return ok ? 0 : -1;
}

static int set_bound_freq(const char *which, int cluster_idx, const char *khz) {
    cluster_t clusters[MAX_CORES];
    int n = resolve_clusters(clusters, MAX_CORES);
    if (n == 0) return -1;
    int start = cluster_idx == ALL ? 0 : cluster_idx;
    int end = cluster_idx == ALL ? n : cluster_idx + 1;
    if (cluster_idx != ALL && (cluster_idx < 0 || cluster_idx >= n)) {
        fprintf(stderr, "invalid cluster: %d (available 0-%d)\n", cluster_idx, n - 1);
        return -1;
    }
    int ok = 1;
    for (int i = start; i < end; i++) {
        for (int j = 0; j < clusters[i].count; j++) {
            int cpu = clusters[i].cores[j];
            char path[256];
            snprintf(path, sizeof(path), "%s/cpu%d/cpufreq/scaling_%s_freq", CPU_SYS_PATH, cpu, which);
            if (write_file(path, khz) == 0)
                printf("cluster%d/cpu%d -> %s_freq: %s kHz\n", i, cpu, which, khz);
            else
                ok = 0;
        }
    }
    return ok ? 0 : -1;
}

/* ================= GPU ================= */

static int find_gpu_devfreq(char *out, size_t size) {
    if (access("/sys/class/kgsl/kgsl-3d0/devfreq", F_OK) == 0) {
        snprintf(out, size, "/sys/class/kgsl/kgsl-3d0/devfreq");
        return 0;
    }
    DIR *dir = opendir(DEVFREQ_PATH);
    if (!dir) return -1;

    struct dirent *entry;
    char fallback[256] = "";
    while ((entry = readdir(dir)) != NULL) {
        if (entry->d_name[0] == '.') continue;
        char lower[128];
        size_t j = 0;
        for (; entry->d_name[j] && j < sizeof(lower) - 1; j++)
            lower[j] = (char)tolower((unsigned char)entry->d_name[j]);
        lower[j] = 0;

        if (strstr(lower, "gpu") || strstr(lower, "mali") ||
            strstr(lower, "kgsl") || strstr(lower, "adreno")) {
            snprintf(out, size, "%s/%s", DEVFREQ_PATH, entry->d_name);
            closedir(dir);
            return 0;
        }
        if (fallback[0] == 0)
            snprintf(fallback, sizeof(fallback), "%s/%s", DEVFREQ_PATH, entry->d_name);
    }
    closedir(dir);

    if (fallback[0] != 0) {
        fprintf(stderr, "warning: no clear GPU match, using first devfreq device: %s\n", fallback);
        snprintf(out, size, "%s", fallback);
        return 0;
    }
    return -1;
}

static void list_gpu_governor(void) {
    char base[256], path[300], buf[MAX_LINE];
    if (find_gpu_devfreq(base, sizeof(base)) != 0) { fprintf(stderr, "could not find GPU devfreq path\n"); return; }
    snprintf(path, sizeof(path), "%s/available_governors", base);
    if (read_file(path, buf, sizeof(buf)) == 0) printf("GPU available governors: %s\n", buf);
    snprintf(path, sizeof(path), "%s/governor", base);
    if (read_file(path, buf, sizeof(buf)) == 0) printf("GPU governor: %s\n", buf);
}

static void list_gpu_freq(void) {
    char base[256], path[300], buf[MAX_LINE];
    if (find_gpu_devfreq(base, sizeof(base)) != 0) { fprintf(stderr, "could not find GPU devfreq path\n"); return; }
    snprintf(path, sizeof(path), "%s/available_frequencies", base);
    if (read_file(path, buf, sizeof(buf)) == 0) printf("GPU available frequencies (Hz): %s\n", buf);
    snprintf(path, sizeof(path), "%s/min_freq", base);
    if (read_file(path, buf, sizeof(buf)) == 0) printf("GPU min: %s Hz\n", buf);
    snprintf(path, sizeof(path), "%s/max_freq", base);
    if (read_file(path, buf, sizeof(buf)) == 0) printf("GPU max: %s Hz\n", buf);
    snprintf(path, sizeof(path), "%s/cur_freq", base);
    if (read_file(path, buf, sizeof(buf)) == 0) printf("GPU cur: %s Hz\n", buf);
}

static int set_gpu_governor(const char *governor) {
    char base[256], path[300];
    if (find_gpu_devfreq(base, sizeof(base)) != 0) { fprintf(stderr, "could not find GPU devfreq path\n"); return -1; }
    snprintf(path, sizeof(path), "%s/governor", base);
    if (write_file(path, governor) == 0) { printf("GPU -> governor: %s\n", governor); return 0; }
    return -1;
}

static int set_gpu_bound_freq(const char *which, const char *val) {
    char base[256], path[300];
    if (find_gpu_devfreq(base, sizeof(base)) != 0) { fprintf(stderr, "could not find GPU devfreq path\n"); return -1; }
    snprintf(path, sizeof(path), "%s/%s_freq", base, which);
    if (write_file(path, val) == 0) { printf("GPU -> %s_freq: %s Hz\n", which, val); return 0; }
    return -1;
}

/* ================= CLI ================= */

static void print_usage(const char *prog) {
    printf("CPU:\n");
    printf("  %s --list clusters\n", prog);
    printf("  %s --set governor <name> [--cluster N]\n", prog);
    printf("  %s --set min_freq <khz> [--cluster N]\n", prog);
    printf("  %s --set max_freq <khz> [--cluster N]\n", prog);
    printf("GPU:\n");
    printf("  %s --list gpu_governor\n", prog);
    printf("  %s --list gpu_freq\n", prog);
    printf("  %s --set gpu_governor <name>\n", prog);
    printf("  %s --set gpu_min_freq <hz>\n", prog);
    printf("  %s --set gpu_max_freq <hz>\n", prog);
    printf("* no --cluster: applies to all clusters.\n");
}

static int parse_int_arg(int argc, char *argv[], const char *flag) {
    for (int i = 1; i < argc - 1; i++)
        if (strcmp(argv[i], flag) == 0) return atoi(argv[i + 1]);
    return NONE;
}

int main(int argc, char *argv[]) {
    if (argc < 3) { print_usage(argv[0]); return 1; }

    int cluster = parse_int_arg(argc, argv, "--cluster");
    if (cluster == NONE) cluster = ALL;

    if (strcmp(argv[1], "--list") == 0) {
        if (strcmp(argv[2], "clusters") == 0) {
            list_clusters();
        } else if (strcmp(argv[2], "gpu_governor") == 0) {
            list_gpu_governor();
        } else if (strcmp(argv[2], "gpu_freq") == 0) {
            list_gpu_freq();
        } else { fprintf(stderr, "unknown option: %s\n", argv[2]); return 1; }
    } else if (strcmp(argv[1], "--set") == 0) {
        if (argc < 4) { print_usage(argv[0]); return 1; }

        if (strcmp(argv[2], "governor") == 0) return set_governor(cluster, argv[3]) == 0 ? 0 : 1;
        else if (strcmp(argv[2], "min_freq") == 0) return set_bound_freq("min", cluster, argv[3]) == 0 ? 0 : 1;
        else if (strcmp(argv[2], "max_freq") == 0) return set_bound_freq("max", cluster, argv[3]) == 0 ? 0 : 1;
        else if (strcmp(argv[2], "gpu_governor") == 0) return set_gpu_governor(argv[3]) == 0 ? 0 : 1;
        else if (strcmp(argv[2], "gpu_min_freq") == 0) return set_gpu_bound_freq("min", argv[3]) == 0 ? 0 : 1;
        else if (strcmp(argv[2], "gpu_max_freq") == 0) return set_gpu_bound_freq("max", argv[3]) == 0 ? 0 : 1;
        else { fprintf(stderr, "unknown option: %s\n", argv[2]); return 1; }
    } else { print_usage(argv[0]); return 1; }

    return 0;
}