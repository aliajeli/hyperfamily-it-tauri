#include "../inventory_json.hpp"
#include <iostream>
#include <stdexcept>

void expect(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
int main() {
    try {
        expect(hf::jsonString(L"") == "\"\"", "empty string");
        expect(hf::jsonString(L"a\"\\\n\r\t") == "\"a\\\"\\\\\\u000a\\u000d\\u0009\"", "quotes, slashes and control characters");
        expect(hf::jsonString(L"\u0641\u0627\u0631\u0633\u06cc") == "\"\\u0641\\u0627\\u0631\\u0633\\u06cc\"", "Persian text");
        expect(hf::jsonString(L"\U0001f600") == "\"\\ud83d\\ude00\"", "supplementary Unicode");
        const std::wstring embeddedNull{L'a', L'\0', L'b'};
        expect(hf::jsonString(embeddedNull) == "\"a\\u0000b\"", "embedded null");
        const auto empty = hf::snapshotJson(L"3.0.1-beta.8", L"CO-01", 42, L"id", 2, L"2026-09-09T00:00:00.000Z", {});
        expect(empty.find("\"protocolVersion\":1") != std::string::npos, "protocol version");
        expect(empty.find("\"programs\":[]") != std::string::npos, "empty inventory is an array");
        expect(empty.find("\"inventoryError\":null") != std::string::npos, "no-error null");
        expect(empty.find("\"sequence\":2") != std::string::npos, "sequence is numeric");
        const std::vector<hf::InstalledProgram> programs{{L"Registry64\\key", L"Store Commerce", L"9.52", L"Microsoft", L"C:\\Store Commerce"}};
        const auto full = hf::snapshotJson(L"8", L"CO-01", 42, L"id", 3, L"date", programs);
        expect(full.find("\"name\":\"Store Commerce\"") != std::string::npos, "program name");
        expect(full.find("\"version\":\"9.52\"") != std::string::npos, "program version");
        expect(full.find("C:\\\\Store Commerce") != std::string::npos, "Windows path escaping");
        const auto failure = hf::snapshotJson(L"8", L"CO-01", 42, L"id", 4, L"date", {}, L"Registry denied");
        expect(failure.find("\"inventoryError\":\"Registry denied\"") != std::string::npos, "registry failure differs from empty inventory");
        std::cout << "Native agent JSON tests passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
