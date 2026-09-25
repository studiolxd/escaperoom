-- B-14: invitationStats hace NOT EXISTS(... r."regeneratedFrom" = k.code) en cada sondeo del dashboard.
CREATE INDEX CONCURRENTLY "ixAccessKeyRegeneratedFrom" ON "accessKey"("regeneratedFrom");
