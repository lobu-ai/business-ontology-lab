import contextlib
import io
import unittest
from apply_demo import upsert_type


class Client:
    def __init__(self, owned=False, fail_read=False):
        self.owned = owned
        self.fail_read = fail_read
        self.writes = []

    def call(self, method, args, write=False):
        if method == "entitySchema.getType":
            return {"entity_type": {"slug": "company"}}
        if method == "entitySchema.listTypes":
            assert args == {"list_scope": "organization"}
            if self.fail_read:
                raise RuntimeError("ownership discovery failed")
            return {"entity_types": [{"slug": "company"}] if self.owned else []}
        if method in ("entitySchema.createType", "entitySchema.updateType"):
            assert write is True
            self.writes.append((method, args))
            return {"entity_type": args}
        raise AssertionError(method)


class SchemaScopeTest(unittest.TestCase):
    def install(self, client):
        with contextlib.redirect_stdout(io.StringIO()):
            return upsert_type(client, {"slug": "company", "name": "Companies"})

    def test_inherited_public_type_creates_workspace_owned_definition(self):
        client = Client()
        self.install(client)
        self.assertEqual(client.writes[0][0], "entitySchema.createType")

    def test_owned_type_is_updated(self):
        client = Client(owned=True)
        self.install(client)
        self.assertEqual(client.writes[0][0], "entitySchema.updateType")

    def test_failed_ownership_read_does_not_attempt_write(self):
        client = Client(fail_read=True)
        with self.assertRaisesRegex(RuntimeError, "ownership discovery failed"):
            self.install(client)
        self.assertEqual(client.writes, [])


if __name__ == "__main__":
    unittest.main()
