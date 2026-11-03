export LANG=C LC_ALL=C
set -e
printf '__RACKTOP_CPUONLY__\n1\n'
printf '__RACKTOP_USER__\n'; id -un
printf '__RACKTOP_UIDMIN__\n'; awk '$1 == "UID_MIN" { print $2; found=1; exit } END { if (!found) print 1000 }' /etc/login.defs 2>/dev/null || printf '1000\n'
printf '__RACKTOP_HOST__\n'; hostname
printf '__RACKTOP_OS__\n'; if [ -r /etc/os-release ]; then . /etc/os-release; printf '%s|%s\n' "${ID:-unknown}" "${PRETTY_NAME:-Linux}"; else printf 'unknown|Linux\n'; fi
printf '__RACKTOP_CPUMODEL__\n'; awk -F: '/^model name[[:space:]]*:/ {sub(/^[[:space:]]+/, "", $2); print $2; exit}' /proc/cpuinfo
capture_process_ticks() {
  awk '{pid=$1; row=$0; sub(/^.*\) /, "", row); n=split(row, f, / +/); if (n >= 20) printf "%s|%s|%.0f\n", pid, f[20], f[12]+f[13]}' /proc/[0-9]*/stat 2>/dev/null || true
}
printf '__RACKTOP_CPU1__\n'; head -n 1 /proc/stat
if [ "${RACKTOP_INCLUDE_PROCESSES:-1}" = 1 ]; then
  printf '__RACKTOP_PROCTICKS1__\n'; capture_process_ticks
fi
sleep 0.25
if [ "${RACKTOP_INCLUDE_PROCESSES:-1}" = 1 ]; then
  printf '__RACKTOP_PROCTICKS2__\n'; capture_process_ticks
fi
printf '__RACKTOP_CPU2__\n'; head -n 1 /proc/stat
printf '__RACKTOP_LOAD__\n'; cat /proc/loadavg
printf '__RACKTOP_MEM__\n'; grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo
if [ "${RACKTOP_INCLUDE_DISKS:-1}" = 1 ]; then
  printf '__RACKTOP_DISK__\n'
  if ! disk_rows="$(timeout -k 1 3 df -P -k -x tmpfs -x devtmpfs 2>/dev/null)"; then
    disk_rows="$(timeout -k 1 3 df -P -k -l -x tmpfs -x devtmpfs 2>/dev/null || true)"
  fi
  printf '%s\n' "$disk_rows" | awk 'NR > 1 && $2 ~ /^[0-9]+$/ {print $6 "|" $3 "|" $2 "|" $4}' | while IFS='|' read -r mount used total available; do
    case "$mount" in /sys|/sys/*|/proc|/proc/*|/dev|/dev/*|/run|/run/*|/boot/efi|/boot/efi/*|/snap/*|/var/lib/docker/*|/var/lib/containers/*|/var/lib/kubelet/*) continue ;; esac
    printf '%s|%s|%s|%s\n' "$mount" "$used" "$total" "$available"
  done
fi
printf '__RACKTOP_USERCPU__\n'
ps -u "$(id -u)" -o pcpu= 2>/dev/null | awk -v n="$(getconf _NPROCESSORS_ONLN 2>/dev/null || printf 1)" '{s+=$1} END {printf "%.2f\n", (n>0?s/n:s+0)}'
printf '__RACKTOP_USERMEM__\n'
ps -u "$(id -u)" -o rss= 2>/dev/null | awk '{s+=$1} END {printf "%.0f\n", s*1024}'
if [ "${RACKTOP_INCLUDE_PROCESSES:-1}" = 1 ]; then
  # Full visible process ownership/RSS, independently of the capped detail list.
  if user_rows="$(ps -eo pid,uid,user:64,rss --no-headers 2>/dev/null)"; then
    printf '__RACKTOP_USERPROCESSES__\n'
    printf '%s\n' "$user_rows" | awk '{printf "%s|%s|%s|%s\n", $1, $2, $3, $4}'
  fi
  printf '__RACKTOP_PS__\n'
  ps -eo user:64=,uid=,pid=,ppid=,pgid=,pcpu=,pmem=,rss=,etime=,args= --sort=-pcpu 2>/dev/null | head -n 128 || true
fi
printf '__RACKTOP_END__\n'
