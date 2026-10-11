"""Check restyle scheduling and retry semantics without invoking image models."""

import asyncio
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import main


class RestyleSchedulingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.job_id = "restyle-scheduling-test"
        self.key = (self.job_id, "dreamy-pink")
        main.jobs[self.job_id] = {
            "status": "complete",
            "result": {"sky": {"eligible": True, "status": "supported", "skyFraction": 0.4}},
        }
        self.started = []

        async def record_start(job_id, style):
            self.started.append((job_id, style))

        self.runner = patch.object(main, "_run_restyle", record_start)
        self.runner.start()

    async def asyncTearDown(self):
        self.runner.stop()
        main.jobs.pop(self.job_id, None)
        main.restyle_jobs.pop(self.key, None)

    async def submit(self):
        result = await main.create_restyle(
            main.RestyleRequest(jobId=self.job_id, style=self.key[1])
        )
        await asyncio.sleep(0)
        return result

    async def test_failed_job_can_retry(self):
        main.restyle_jobs[self.key] = {"status": "failed", "error": "GPU error"}
        result = await self.submit()
        self.assertEqual(result["status"], "processing")
        self.assertEqual(self.started, [self.key])
        self.assertNotIn("error", main.restyle_jobs[self.key])

    async def test_repeated_processing_request_does_not_duplicate_task(self):
        await self.submit()
        await self.submit()
        self.assertEqual(self.started, [self.key])

    async def test_complete_job_reuses_result(self):
        cached = {"status": "complete", "backgroundUrl": "/media/saved.png"}
        main.restyle_jobs[self.key] = cached
        result = await self.submit()
        self.assertEqual(result["status"], "complete")
        self.assertEqual(self.started, [])
        self.assertIs(main.restyle_jobs[self.key], cached)

    async def test_no_sky_returns_422_without_creating_a_task(self):
        reason = "No sufficiently clear sky was detected. Choose an outdoor photo with visible sky."
        main.jobs[self.job_id]["result"]["sky"] = {
            "eligible": False, "status": "no-sky", "skyFraction": 0, "reason": reason,
        }
        with patch.object(main.asyncio, "create_task") as create_task:
            with self.assertRaises(HTTPException) as failure:
                await self.submit()
            self.assertEqual(failure.exception.status_code, 422)
            self.assertEqual(failure.exception.detail, reason)
            create_task.assert_not_called()
        self.assertNotIn(self.key, main.restyle_jobs)
        self.assertEqual(self.started, [])

    async def test_unavailable_sky_returns_422_without_creating_a_task(self):
        reason = "Sky analysis is unavailable. Check the local model setup and upload again."
        main.jobs[self.job_id]["result"]["sky"] = {
            "eligible": False, "status": "unavailable", "skyFraction": 0, "reason": reason,
        }
        with patch.object(main.asyncio, "create_task") as create_task:
            with self.assertRaises(HTTPException) as failure:
                await self.submit()
            self.assertEqual(failure.exception.status_code, 422)
            self.assertEqual(failure.exception.detail, reason)
            create_task.assert_not_called()
        self.assertNotIn(self.key, main.restyle_jobs)

    async def test_missing_sky_result_cannot_schedule_generation(self):
        main.jobs[self.job_id]["result"] = {}
        with self.assertRaises(HTTPException) as failure:
            await self.submit()
        self.assertEqual(failure.exception.status_code, 422)
        self.assertNotIn(self.key, main.restyle_jobs)
        self.assertEqual(self.started, [])


if __name__ == "__main__":
    unittest.main()
