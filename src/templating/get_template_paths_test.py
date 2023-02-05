from pyfakefs.fake_filesystem import FakeFilesystem

from src.templating.get_template_paths import get_template_paths


def test_get_template_paths(fs: FakeFilesystem):
    """
    Test that the globbing works as expected.
    """
    BASE_DIR = "folder"

    for fake_test_file in [
        "foo.yml",
        "foo.yml.j2",
        "nested/bar.yml",
        "nested/bar.yml.j2",
    ]:
        fs.create_file(f"{BASE_DIR}/{fake_test_file}")

    expected_result = [
        f"{BASE_DIR}/foo.yml.j2",
        f"{BASE_DIR}/nested/bar.yml.j2",
    ]
    result = get_template_paths(BASE_DIR)

    assert result == expected_result
