from {{package_slug}}.__main__ import greet, main


def test_greet_uses_the_given_name():
    assert greet("Ada") == "Hello, Ada!"


def test_main_defaults_to_world(capsys):
    assert main([]) == 0
    assert capsys.readouterr().out.strip() == "Hello, world!"
