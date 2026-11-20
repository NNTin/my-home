-- The deprecated named layouts (#56), unused since the release before this one: their data moved to
-- userdata.placements in #44 (userdata.imports keeps the record). An api from before #104 needs the table back to
-- roll back to: docs/deployment.md § Roll back production.
DROP TABLE "layouts" CASCADE;
