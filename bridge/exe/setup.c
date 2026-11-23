/* CA Desk Bridge - Setup.exe
   A small Windows program that runs the CA Desk Bridge installer (PowerShell, embedded below
   from CA-Desk-Bridge-Setup.cmd). Installs for this Windows user only; no admin rights needed.
   CA-Desk-Bridge-Setup.exe /uninstall  removes it (also from Settings -> Apps). */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <wchar.h>
#include "script.h"   /* static const unsigned char SCRIPT[]; SCRIPT_LEN (UTF-8) */

static void pause_exit(int code) {
  printf("\nPress Enter to close this window...");
  fflush(stdout);
  getchar();
  ExitProcess(code);
}

int wmain(int argc, wchar_t **argv) {
  SetConsoleTitleW(L"CA Desk Bridge setup");
  SetConsoleOutputCP(CP_UTF8);
  const wchar_t *mode = L"";
  for (int i = 1; i < argc; i++) {
    if (!_wcsicmp(argv[i], L"/uninstall") || !_wcsicmp(argv[i], L"-uninstall") || !_wcsicmp(argv[i], L"--uninstall")) mode = L"/uninstall";
    if (!_wcsicmp(argv[i], L"/quiet")) SetEnvironmentVariableW(L"CADESK_QUIET", L"1");
  }
  wchar_t self[MAX_PATH * 2];
  GetModuleFileNameW(NULL, self, MAX_PATH * 2);
  SetEnvironmentVariableW(L"MODE", mode);
  SetEnvironmentVariableW(L"SETUP_EXE", self);

  wchar_t tmp[MAX_PATH], ps1[MAX_PATH * 2];
  GetTempPathW(MAX_PATH, tmp);
  swprintf(ps1, MAX_PATH * 2, L"%lsCADeskBridgeSetup-%lu.ps1", tmp, GetCurrentProcessId());
  HANDLE f = CreateFileW(ps1, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_TEMPORARY, NULL);
  if (f == INVALID_HANDLE_VALUE) { printf("Could not write to the TEMP folder (error %lu).\n", GetLastError()); pause_exit(1); }
  DWORD w;
  static const unsigned char bom[] = {0xEF, 0xBB, 0xBF};   /* UTF-8 BOM so Windows PowerShell 5.1 reads it as UTF-8 */
  WriteFile(f, bom, 3, &w, NULL);
  WriteFile(f, SCRIPT, (DWORD)SCRIPT_LEN, &w, NULL);
  CloseHandle(f);

  wchar_t ps[MAX_PATH], cmd[MAX_PATH * 4];
  UINT n = GetSystemDirectoryW(ps, MAX_PATH);
  swprintf(ps + n, MAX_PATH - n, L"\\WindowsPowerShell\\v1.0\\powershell.exe");
  if (GetFileAttributesW(ps) == INVALID_FILE_ATTRIBUTES) wcscpy(ps, L"powershell.exe");
  swprintf(cmd, MAX_PATH * 4, L"\"%ls\" -NoProfile -ExecutionPolicy Bypass -File \"%ls\"", ps, ps1);

  STARTUPINFOW si; PROCESS_INFORMATION pi;
  ZeroMemory(&si, sizeof si); si.cb = sizeof si; ZeroMemory(&pi, sizeof pi);
  DWORD code = 1;
  if (!CreateProcessW(NULL, cmd, NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi)) {
    printf("Could not start Windows PowerShell (error %lu).\n", GetLastError());
  } else {
    WaitForSingleObject(pi.hProcess, INFINITE);
    GetExitCodeProcess(pi.hProcess, &code);
    CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
  }
  DeleteFileW(ps1);
  if (code != 0) printf("\nSetup did not finish (code %lu). Check your internet connection and run it again.\n", code);
  if (GetEnvironmentVariableW(L"CADESK_QUIET", NULL, 0)) ExitProcess(code);
  pause_exit((int)code);
  return 0;
}
