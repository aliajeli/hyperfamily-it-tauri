#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace hf {
struct InstalledProgram {
    std::wstring key, name, version, publisher, installLocation;
};

// Escape UTF-16 directly: no locale/codepage dependence, including Persian,
// control characters, quotes, backslashes and supplementary Unicode pairs.
inline void appendHex(std::string& out, std::uint32_t unit) {
    constexpr char digits[] = "0123456789abcdef";
    out += "\\u";
    for (int shift = 12; shift >= 0; shift -= 4) out += digits[(unit >> shift) & 15];
}
inline std::string jsonString(const std::wstring& value) {
    std::string out = "\"";
    for (wchar_t ch : value) {
        const auto unit = static_cast<std::uint32_t>(ch);
        if (ch == L'"') out += "\\\"";
        else if (ch == L'\\') out += "\\\\";
        else if (unit >= 0x20 && unit <= 0x7e) out += static_cast<char>(ch);
        else if (unit <= 0xffff) appendHex(out, unit);
        else if (unit <= 0x10ffff) {
            // Also enables the same serializer tests on hosts with 32-bit wchar_t.
            appendHex(out, 0xd800 + ((unit - 0x10000) >> 10));
            appendHex(out, 0xdc00 + ((unit - 0x10000) & 0x3ff));
        } else appendHex(out, 0xfffd);
    }
    return out + '"';
}
inline std::string snapshotJson(const std::wstring& version, const std::wstring& machine,
    std::uint32_t pid, const std::wstring& instance, std::uint64_t sequence,
    const std::wstring& generatedAt, const std::vector<InstalledProgram>& programs,
    const std::wstring& inventoryError = L"") {
    std::string out = "{\"protocolVersion\":1,\"agentVersion\":" + jsonString(version) +
        ",\"machineName\":" + jsonString(machine) + ",\"pid\":" + std::to_string(pid) +
        ",\"instanceId\":" + jsonString(instance) + ",\"sequence\":" + std::to_string(sequence) +
        ",\"generatedAt\":" + jsonString(generatedAt) + ",\"state\":\"running\",\"inventoryError\":" +
        (inventoryError.empty() ? "null" : jsonString(inventoryError)) + ",\"programs\":[";
    bool first = true;
    for (const auto& program : programs) {
        if (!first) out += ',';
        first = false;
        out += "{\"key\":" + jsonString(program.key) + ",\"name\":" + jsonString(program.name) +
            ",\"version\":" + jsonString(program.version) + ",\"publisher\":" + jsonString(program.publisher) +
            ",\"installLocation\":" + jsonString(program.installLocation) + '}';
    }
    return out + "]}";
}
} // namespace hf
