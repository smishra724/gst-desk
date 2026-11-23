/* CA Desk Connector - CA-Desk-Connector.exe
   Double-click: installs (first time) and starts the CA Desk connector that links CA Desk to Tally and
   DSC tokens on this computer. Lives next to the clock, starts with Windows, updates from its tray menu.
   Per Windows user, no admin rights. "/uninstall" removes it (Settings -> Apps uses this). */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <wchar.h>
#include "payload.h"  /* BOOT[], BRIDGE[], LAUNCHER[], ICON[] and their _LEN */

static int put(const wchar_t *dir, const wchar_t *name, const unsigned char *data, DWORD len, int bom) {
  wchar_t p[MAX_PATH * 2]; DWORD w;
  swprintf(p, MAX_PATH * 2, L"%ls\\%ls", dir, name);
  HANDLE f = CreateFileW(p, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  if (f == INVALID_HANDLE_VALUE) return 0;
  if (bom) { static const unsigned char b[] = {0xEF, 0xBB, 0xBF}; WriteFile(f, b, 3, &w, NULL); }
  int ok = WriteFile(f, data, len, &w, NULL) && w == len;
  CloseHandle(f);
  return ok;
}
static void rmtree(const wchar_t *dir) {
  const wchar_t *names[] = {L"connector.ps1", L"bridge.ps1", L"launcher.vbs", L"icon.ico"};
  wchar_t p[MAX_PATH * 2];
  for (int i = 0; i < 4; i++) { swprintf(p, MAX_PATH * 2, L"%ls\\%ls", dir, names[i]); DeleteFileW(p); }
  RemoveDirectoryW(dir);
}

int WINAPI wWinMain(HINSTANCE h, HINSTANCE prev, PWSTR args, int show) {
  int argc; wchar_t **argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  SetEnvironmentVariableW(L"MODE", L"");
  for (int i = 1; argv && i < argc; i++) {
    if (!_wcsicmp(argv[i], L"/uninstall") || !_wcsicmp(argv[i], L"-uninstall") || !_wcsicmp(argv[i], L"--uninstall")) SetEnvironmentVariableW(L"MODE", L"/uninstall");
    if (!_wcsicmp(argv[i], L"/startup")) SetEnvironmentVariableW(L"CADESK_STARTUP", L"1");
    if (!_wcsicmp(argv[i], L"/open")) SetEnvironmentVariableW(L"CADESK_OPEN", L"1");
  }
  wchar_t self[MAX_PATH * 2];
  GetModuleFileNameW(NULL, self, MAX_PATH * 2);
  SetEnvironmentVariableW(L"CADESK_EXE", self);

  wchar_t tmp[MAX_PATH], dir[MAX_PATH * 2];
  GetTempPathW(MAX_PATH, tmp);
  swprintf(dir, MAX_PATH * 2, L"%lsCADeskConnector-%lu", tmp, GetCurrentProcessId());
  CreateDirectoryW(dir, NULL);
  if (!put(dir, L"connector.ps1", BOOT, BOOT_LEN, 1) || !put(dir, L"bridge.ps1", BRIDGE, BRIDGE_LEN, 1) ||
      !put(dir, L"launcher.vbs", LAUNCHER, LAUNCHER_LEN, 0) || !put(dir, L"icon.ico", ICON, ICON_LEN, 0)) {
    MessageBoxW(NULL, L"Could not write to the TEMP folder.", L"CA Desk Bridge", MB_ICONWARNING);
    rmtree(dir); return 1;
  }
  SetEnvironmentVariableW(L"CADESK_PAYLOAD", dir);

  wchar_t ps[MAX_PATH], cmd[MAX_PATH * 4];
  UINT n = GetSystemDirectoryW(ps, MAX_PATH);
  swprintf(ps + n, MAX_PATH - n, L"\\WindowsPowerShell\\v1.0\\powershell.exe");
  if (GetFileAttributesW(ps) == INVALID_FILE_ATTRIBUTES) wcscpy(ps, L"powershell.exe");
  swprintf(cmd, MAX_PATH * 4, L"\"%ls\" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%ls\\connector.ps1\"", ps, dir);

  STARTUPINFOW si; PROCESS_INFORMATION pi;
  ZeroMemory(&si, sizeof si); si.cb = sizeof si; si.dwFlags = STARTF_USESHOWWINDOW; si.wShowWindow = SW_HIDE;
  ZeroMemory(&pi, sizeof pi);
  DWORD code = 1;
  if (!CreateProcessW(NULL, cmd, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) {
    MessageBoxW(NULL, L"Could not start Windows PowerShell, which CA Desk Bridge needs.", L"CA Desk Bridge", MB_ICONWARNING);
  } else {
    WaitForSingleObject(pi.hProcess, INFINITE);
    GetExitCodeProcess(pi.hProcess, &code);
    CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
  }
  rmtree(dir);
  return (int)code;
}
