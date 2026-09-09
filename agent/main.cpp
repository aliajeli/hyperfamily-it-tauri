#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <shellapi.h>
#include <objbase.h>
#include <algorithm>
#include <cwchar>
#include <cwctype>
#include <stdexcept>
#include <utility>
#include <vector>
#include "inventory_json.hpp"
#include "agent_version.hpp"

namespace {
constexpr wchar_t serviceName[] = L"HyperFamilyStoreAgent";
constexpr wchar_t uninstallPath[] = L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall";
constexpr DWORD heartbeatMs = 15000;
constexpr DWORD maxValueBytes = 2 * 1024 * 1024;
constexpr std::size_t maxSnapshotBytes = 8 * 1024 * 1024;

struct WinError : std::runtime_error {
    DWORD code;
    explicit WinError(DWORD value) : std::runtime_error("Windows agent operation failed"), code(value) {}
};
struct StopRequested {};
class Handle {
    HANDLE value_;
public:
    explicit Handle(HANDLE value = INVALID_HANDLE_VALUE) : value_(value) {}
    ~Handle() { close(); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    HANDLE get() const { return value_; }
    void close() { if (value_ && value_ != INVALID_HANDLE_VALUE) CloseHandle(value_); value_ = INVALID_HANDLE_VALUE; }
};
class RegistryKey {
public:
    HKEY value = nullptr;
    ~RegistryKey() { if (value) RegCloseKey(value); }
    RegistryKey() = default;
    RegistryKey(const RegistryKey&) = delete;
    RegistryKey& operator=(const RegistryKey&) = delete;
};
void throwUnlessSuccess(LSTATUS result) {
    if (result != ERROR_SUCCESS) throw WinError(static_cast<DWORD>(result));
}
bool missing(LSTATUS result) { return result == ERROR_FILE_NOT_FOUND || result == ERROR_KEY_DELETED; }
void checkStop(HANDLE event) {
    if (event && WaitForSingleObject(event, 0) == WAIT_OBJECT_0) throw StopRequested{};
}
std::wstring trim(std::wstring value) {
    const auto first = value.find_first_not_of(L" \t\r\n\v\f\u00a0");
    if (first == std::wstring::npos) return L"";
    return value.substr(first, value.find_last_not_of(L" \t\r\n\v\f\u00a0") - first + 1);
}
std::wstring readString(HKEY key, const wchar_t* name) {
    for (int attempt = 0; attempt < 3; ++attempt) {
        DWORD type = 0, size = 0;
        LSTATUS result = RegQueryValueExW(key, name, nullptr, &type, nullptr, &size);
        if (missing(result)) return L"";
        throwUnlessSuccess(result);
        if (type != REG_SZ && type != REG_EXPAND_SZ) return L"";
        if (size > maxValueBytes || size % sizeof(wchar_t)) throw WinError(ERROR_INVALID_DATA);
        std::vector<wchar_t> buffer(size / sizeof(wchar_t) + 1, L'\0');
        result = RegQueryValueExW(key, name, nullptr, &type, reinterpret_cast<BYTE*>(buffer.data()), &size);
        if (result == ERROR_MORE_DATA) continue; // An installer may have changed it between calls.
        if (missing(result)) return L"";
        throwUnlessSuccess(result);
        if ((type != REG_SZ && type != REG_EXPAND_SZ) || size % sizeof(wchar_t)) throw WinError(ERROR_INVALID_DATA);
        buffer[size / sizeof(wchar_t)] = L'\0';
        std::wstring value(buffer.data());
        if (type == REG_EXPAND_SZ) {
            DWORD count = ExpandEnvironmentStringsW(value.c_str(), nullptr, 0);
            if (!count || count > maxValueBytes / sizeof(wchar_t)) throw WinError(ERROR_INVALID_DATA);
            std::vector<wchar_t> expanded(count, L'\0');
            const DWORD written = ExpandEnvironmentStringsW(value.c_str(), expanded.data(), count);
            if (!written || written > count) throw WinError(ERROR_INVALID_DATA);
            value.assign(expanded.data());
        }
        return trim(std::move(value));
    }
    throw WinError(ERROR_MORE_DATA);
}
int compareOrdinal(const std::wstring& a, const std::wstring& b) {
    const int result = CompareStringOrdinal(a.c_str(), static_cast<int>(a.size()), b.c_str(), static_cast<int>(b.size()), TRUE);
    if (!result) throw WinError(GetLastError());
    return result - CSTR_EQUAL;
}
std::vector<hf::InstalledProgram> readPrograms(HANDLE stopEvent) {
    std::vector<hf::InstalledProgram> programs;
    // Both machine registry views, never HKCU, Win32_Product, WMI or the network.
    for (const REGSAM view : {REGSAM(KEY_WOW64_64KEY), REGSAM(KEY_WOW64_32KEY)}) {
        checkStop(stopEvent);
        RegistryKey uninstall;
        const LSTATUS opened = RegOpenKeyExW(HKEY_LOCAL_MACHINE, uninstallPath, 0, KEY_READ | view, &uninstall.value);
        if (missing(opened)) continue;
        throwUnlessSuccess(opened);
        for (DWORD index = 0; ; ++index) {
            checkStop(stopEvent);
            wchar_t name[256]{};
            DWORD count = 256;
            const LSTATUS enumerated = RegEnumKeyExW(uninstall.value, index, name, &count, nullptr, nullptr, nullptr, nullptr);
            if (enumerated == ERROR_NO_MORE_ITEMS) break;
            throwUnlessSuccess(enumerated);
            RegistryKey key;
            const LSTATUS result = RegOpenKeyExW(uninstall.value, name, 0, KEY_QUERY_VALUE | view, &key.value);
            if (missing(result)) continue;
            throwUnlessSuccess(result);
            auto displayName = readString(key.value, L"DisplayName");
            if (displayName.empty()) continue;
            programs.push_back({std::wstring(view == KEY_WOW64_64KEY ? L"Registry64\\" : L"Registry32\\") + name,
                std::move(displayName), readString(key.value, L"DisplayVersion"), readString(key.value, L"Publisher"), readString(key.value, L"InstallLocation")});
            if (programs.size() > 20000) throw WinError(ERROR_BUFFER_OVERFLOW);
        }
    }
    std::sort(programs.begin(), programs.end(), [](const auto& a, const auto& b) {
        const int name = compareOrdinal(a.name, b.name);
        return name < 0 || (name == 0 && compareOrdinal(a.version, b.version) < 0);
    });
    programs.erase(std::unique(programs.begin(), programs.end(), [](const auto& a, const auto& b) {
        return compareOrdinal(a.name, b.name) == 0 && compareOrdinal(a.version, b.version) == 0;
    }), programs.end());
    return programs;
}
std::wstring newId() {
    GUID id{};
    if (FAILED(CoCreateGuid(&id))) throw WinError(ERROR_GEN_FAILURE);
    wchar_t text[40]{};
    if (!StringFromGUID2(id, text, 40)) throw WinError(ERROR_GEN_FAILURE);
    std::wstring value(text);
    value.erase(std::remove_if(value.begin(), value.end(), [](wchar_t ch) { return ch == L'{' || ch == L'}' || ch == L'-'; }), value.end());
    return value;
}
std::wstring utcNow() {
    SYSTEMTIME now{};
    GetSystemTime(&now);
    wchar_t buffer[40]{};
    std::swprintf(buffer, 40, L"%04u-%02u-%02uT%02u:%02u:%02u.%03uZ",
        static_cast<unsigned>(now.wYear), static_cast<unsigned>(now.wMonth), static_cast<unsigned>(now.wDay),
        static_cast<unsigned>(now.wHour), static_cast<unsigned>(now.wMinute), static_cast<unsigned>(now.wSecond), static_cast<unsigned>(now.wMilliseconds));
    return buffer;
}
std::wstring machineName() {
    wchar_t buffer[MAX_COMPUTERNAME_LENGTH + 1]{};
    DWORD count = MAX_COMPUTERNAME_LENGTH + 1;
    if (!GetComputerNameW(buffer, &count)) throw WinError(GetLastError());
    return std::wstring(buffer, count);
}
std::wstring executableDirectory() {
    std::vector<wchar_t> buffer(32768, L'\0');
    const DWORD count = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
    if (!count || count >= buffer.size()) throw WinError(ERROR_INVALID_NAME);
    const std::wstring filename(buffer.data(), count);
    const auto separator = filename.find_last_of(L"\\/");
    if (separator == std::wstring::npos) throw WinError(ERROR_INVALID_NAME);
    return filename.substr(0, separator);
}
void ensureDirectory(const std::wstring& directory) {
    if (!CreateDirectoryW(directory.c_str(), nullptr) && GetLastError() != ERROR_ALREADY_EXISTS) throw WinError(GetLastError());
    const DWORD attributes = GetFileAttributesW(directory.c_str());
    if (attributes == INVALID_FILE_ATTRIBUTES || !(attributes & FILE_ATTRIBUTE_DIRECTORY) || (attributes & FILE_ATTRIBUTE_REPARSE_POINT)) throw WinError(ERROR_ACCESS_DENIED);
}
void writeBytes(HANDLE file, const std::string& bytes) {
    DWORD offset = 0;
    while (offset < bytes.size()) {
        DWORD written = 0;
        if (!WriteFile(file, bytes.data() + offset, static_cast<DWORD>(bytes.size() - offset), &written, nullptr)) throw WinError(GetLastError());
        if (!written) throw WinError(ERROR_WRITE_FAULT);
        offset += written;
    }
}
void writeSnapshot(const std::wstring& directory, const std::string& bytes) {
    if (bytes.size() > maxSnapshotBytes) throw WinError(ERROR_BUFFER_OVERFLOW);
    const std::wstring temporary = directory + L"\\inventory-" + newId() + L".tmp";
    const std::wstring destination = directory + L"\\inventory.json";
    // CREATE_NEW + a unique name prevents following/replacing a pre-existing
    // temporary file. Same-directory rename publishes complete JSON atomically.
    const HANDLE raw = CreateFileW(temporary.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (raw == INVALID_HANDLE_VALUE) throw WinError(GetLastError());
    Handle file(raw);
    try {
        writeBytes(file.get(), bytes);
        if (!FlushFileBuffers(file.get())) throw WinError(GetLastError());
        file.close();
        if (!MoveFileExW(temporary.c_str(), destination.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) throw WinError(GetLastError());
    } catch (...) {
        file.close();
        DeleteFileW(temporary.c_str());
        throw;
    }
}
std::string readSnapshot(const std::wstring& filename) {
    Handle file(CreateFileW(filename.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
    if (file.get() == INVALID_HANDLE_VALUE) throw WinError(GetLastError());
    std::string result;
    char buffer[4096];
    DWORD count = 0;
    do {
        if (!ReadFile(file.get(), buffer, sizeof(buffer), &count, nullptr)) throw WinError(GetLastError());
        result.append(buffer, count);
        if (result.size() > maxSnapshotBytes) throw WinError(ERROR_BUFFER_OVERFLOW);
    } while (count);
    return result;
}

struct ServiceContext {
    SERVICE_STATUS_HANDLE statusHandle = nullptr;
    SERVICE_STATUS status{};
    SRWLOCK lock = SRWLOCK_INIT;
    HANDLE stopEvent = nullptr;
    void report(DWORD state, DWORD error = NO_ERROR) {
        AcquireSRWLockExclusive(&lock);
        if (status.dwCurrentState == SERVICE_STOPPED && state != SERVICE_STOPPED) { ReleaseSRWLockExclusive(&lock); return; }
        status.dwServiceType = SERVICE_WIN32_OWN_PROCESS;
        status.dwCurrentState = state;
        status.dwControlsAccepted = state == SERVICE_RUNNING ? SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN : 0;
        status.dwWin32ExitCode = error;
        status.dwWaitHint = state == SERVICE_START_PENDING || state == SERVICE_STOP_PENDING ? 10000 : 0;
        status.dwCheckPoint = status.dwWaitHint ? status.dwCheckPoint + 1 : 0;
        SetServiceStatus(statusHandle, &status);
        ReleaseSRWLockExclusive(&lock);
    }
    void repeatStatus() {
        AcquireSRWLockExclusive(&lock);
        SetServiceStatus(statusHandle, &status);
        ReleaseSRWLockExclusive(&lock);
    }
} service;
DWORD WINAPI controlHandler(DWORD control, DWORD, LPVOID, LPVOID) {
    if (control == SERVICE_CONTROL_STOP || control == SERVICE_CONTROL_SHUTDOWN) {
        service.report(SERVICE_STOP_PENDING);
        SetEvent(service.stopEvent);
        return NO_ERROR;
    }
    if (control == SERVICE_CONTROL_INTERROGATE) { service.repeatStatus(); return NO_ERROR; }
    return ERROR_CALL_NOT_IMPLEMENTED;
}
void WINAPI serviceMain(DWORD, LPWSTR*) {
    service.statusHandle = RegisterServiceCtrlHandlerExW(serviceName, controlHandler, nullptr);
    if (!service.statusHandle) return;
    service.report(SERVICE_START_PENDING);
    DWORD exitCode = NO_ERROR;
    std::wstring directory;
    try {
        directory = executableDirectory() + L"\\data";
        ensureDirectory(directory);
        const auto instance = newId();
        const auto machine = machineName();
        std::uint64_t sequence = 0;
        service.report(SERVICE_RUNNING);
        while (WaitForSingleObject(service.stopEvent, 0) != WAIT_OBJECT_0) {
            try {
                std::vector<hf::InstalledProgram> programs;
                std::wstring error;
                try { programs = readPrograms(service.stopEvent); }
                catch (const WinError&) { error = L"The agent could not read the local uninstall registry. Check service permissions."; }
                checkStop(service.stopEvent);
                auto json = hf::snapshotJson(hf::agentVersion, machine, GetCurrentProcessId(), instance, ++sequence, utcNow(), programs, error);
                if (json.size() > maxSnapshotBytes) json = hf::snapshotJson(hf::agentVersion, machine, GetCurrentProcessId(), instance, sequence, utcNow(), {}, L"The local inventory exceeds the supported size limit.");
                writeSnapshot(directory, json);
            } catch (const StopRequested&) { break; }
            catch (...) { /* Failed writes stop heartbeat advancement; never claim stale data is fresh. */ }
            if (WaitForSingleObject(service.stopEvent, heartbeatMs) == WAIT_OBJECT_0) break;
        }
    } catch (const WinError& error) { exitCode = error.code; }
    catch (...) { exitCode = ERROR_GEN_FAILURE; }
    if (!directory.empty()) DeleteFileW((directory + L"\\inventory.json").c_str());
    service.report(SERVICE_STOPPED, exitCode);
}
int selfTest() {
    std::wstring directory;
    try {
        wchar_t temporary[32768]{};
        const DWORD count = GetTempPathW(32768, temporary);
        if (!count || count >= 32768) throw WinError(ERROR_INVALID_NAME);
        directory = std::wstring(temporary) + L"HyperFamilyAgentTest-" + newId();
        ensureDirectory(directory);
        auto programs = readPrograms(nullptr);
        programs.push_back({L"SelfTest", L"HyperFamily \"Self-test\" \u0641\u0627\u0631\u0633\u06cc \U0001f600", L"8.0", L"line1\nline2\t", L"C:\\Agent\\test"});
        std::string json;
        for (std::uint64_t sequence = 1; sequence <= 2; ++sequence) {
            json = hf::snapshotJson(hf::agentVersion, machineName(), GetCurrentProcessId(), L"self-test", sequence, utcNow(), programs);
            writeSnapshot(directory, json);
            if (readSnapshot(directory + L"\\inventory.json") != json) throw WinError(ERROR_CRC);
        }
        DeleteFileW((directory + L"\\inventory.json").c_str());
        if (!RemoveDirectoryW(directory.c_str())) throw WinError(GetLastError());
        directory.clear();
        const HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
        if (output && output != INVALID_HANDLE_VALUE) writeBytes(output, json);
        return 0;
    } catch (...) {
        if (!directory.empty()) { DeleteFileW((directory + L"\\inventory.json").c_str()); RemoveDirectoryW(directory.c_str()); }
        return 1;
    }
}
} // namespace

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    int count = 0;
    LPWSTR* args = CommandLineToArgvW(GetCommandLineW(), &count);
    if (!args) return static_cast<int>(GetLastError());
    const bool test = count == 2 && std::wcscmp(args[1], L"--self-test") == 0;
    LocalFree(args);
    if (test) return selfTest();
    if (count != 1) return ERROR_INVALID_PARAMETER;
    Handle stop(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    if (!stop.get() || stop.get() == INVALID_HANDLE_VALUE) return static_cast<int>(GetLastError());
    service.stopEvent = stop.get();
    SERVICE_TABLE_ENTRYW table[] = {{const_cast<LPWSTR>(serviceName), serviceMain}, {nullptr, nullptr}};
    if (!StartServiceCtrlDispatcherW(table)) return static_cast<int>(GetLastError());
    return static_cast<int>(service.status.dwWin32ExitCode);
}
