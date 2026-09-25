-- E-7: FK audioAsset.organizationId sin índice.
CREATE INDEX CONCURRENTLY "ixAudioAssetOrganization" ON "audioAsset"("organizationId");
