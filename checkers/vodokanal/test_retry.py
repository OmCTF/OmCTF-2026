import unittest
from unittest.mock import Mock

import requests

import checker


class ConnectionRetryTests(unittest.TestCase):
    def setUp(self):
        self.service = checker.Service("127.0.0.1", 18.0)
        self.response = requests.Response()
        self.response.status_code = 200
        self.response.headers["X-API-Contract"] = "1.0"

    def test_get_retries_one_connection_error(self):
        session = Mock()
        session.request.side_effect = [
            requests.exceptions.ConnectionError("closed connection"),
            self.response,
        ]
        self.assertIs(self.service.call("GET", "/healthz", session=session), self.response)
        self.assertEqual(session.request.call_count, 2)

    def test_post_does_not_retry_connection_error(self):
        session = Mock()
        session.request.side_effect = requests.exceptions.ConnectionError("closed connection")
        with self.assertRaises(checker.CheckFailure) as caught:
            self.service.call("POST", "/v1/item", session=session, body={})
        self.assertEqual(caught.exception.code, checker.DOWN)
        self.assertEqual(session.request.call_count, 1)

    def test_registration_retries_read_timeout_with_same_key(self):
        self.response.status_code = 201
        session = Mock()
        session.request.side_effect = [requests.exceptions.ReadTimeout("late response"), self.response]
        body = {"requestId": "38d54b59-311b-48f2-bd58-04122ad72e96"}
        result = self.service.call("POST", "/identity/hs/identity/register",
                                   session=session, body=body, expected=201)
        self.assertIs(result, self.response)
        self.assertEqual(session.request.call_count, 2)
        first, second = session.request.call_args_list
        self.assertEqual(first.kwargs["headers"]["Idempotency-Key"], body["requestId"])
        self.assertEqual(first.kwargs["headers"], second.kwargs["headers"])
        self.assertEqual(first.kwargs["json"], second.kwargs["json"])

    def test_registration_retries_temporary_503(self):
        self.response.status_code = 201
        unavailable = requests.Response()
        unavailable.status_code = 503
        session = Mock()
        session.request.side_effect = [unavailable, self.response]
        self.assertIs(self.service.call("POST", "/identity/hs/identity/register",
                                        session=session, body={"requestId": "request"},
                                        expected=201), self.response)
        self.assertEqual(session.request.call_count, 2)

    def test_file_version_retries_connection_error(self):
        self.response.status_code = 201
        session = Mock()
        session.request.side_effect = [requests.exceptions.ConnectionError("closed connection"), self.response]
        path = "/vodokanal/hs/api/v1/my/request-files/47bad933-4248-44d4-9499-a07ed171af13/versions"
        self.assertIs(self.service.call("POST", path, session=session,
                                        body={"expectedVersion": 1}, expected=201), self.response)
        self.assertEqual(session.request.call_count, 2)
        first, second = session.request.call_args_list
        self.assertEqual(first.kwargs["headers"], second.kwargs["headers"])

    def test_registration_does_not_retry_429(self):
        limited = requests.Response()
        limited.status_code = 429
        session = Mock()
        session.request.return_value = limited
        with self.assertRaises(checker.CheckFailure):
            self.service.call("POST", "/identity/hs/identity/register",
                              session=session, body={"requestId": "request"}, expected=201)
        self.assertEqual(session.request.call_count, 1)


if __name__ == "__main__":
    unittest.main()
