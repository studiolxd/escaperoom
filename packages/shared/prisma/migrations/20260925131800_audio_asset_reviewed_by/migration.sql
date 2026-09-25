-- E-7: FK audioAsset.reviewedBy sin índice.
CREATE INDEX CONCURRENTLY "ixAudioAssetReviewedBy" ON "audioAsset"("reviewedBy");
