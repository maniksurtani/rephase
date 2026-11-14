#!/usr/bin/env bash
set -euo pipefail

# Run after enabling Firebase on the existing Google Cloud project and creating
# the android-beta environment in GitHub. Uses your gcloud and gh login sessions.
project=${1:?Usage: bash scripts/configure-android-beta.sh GOOGLE_CLOUD_PROJECT_ID}
[[ "$project" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || { echo 'Invalid project ID.' >&2; exit 1; }
command -v gcloud >/dev/null
command -v gh >/dev/null
repo=maniksurtani/rephase
gh api "repos/$repo/environments/android-beta" >/dev/null
project_number=$(gcloud projects describe "$project" --format='value(projectNumber)')
[[ "$project_number" =~ ^[0-9]+$ ]]
account="rephase-distribution@$project.iam.gserviceaccount.com"
pool=github-rephase
provider=android-beta
condition="assertion.repository_id == '1419941709' && assertion.repository_owner_id == '47146' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == '$repo/.github/workflows/android-beta.yml@refs/heads/main' && assertion.sub == 'repo:$repo:environment:android-beta'"

gcloud services enable firebaseappdistribution.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project="$project"
if ! gcloud iam service-accounts describe "$account" --project="$project" >/dev/null 2>&1; then
  gcloud iam service-accounts create rephase-distribution --project="$project" --display-name='Rephase Android beta distribution'
fi
gcloud projects add-iam-policy-binding "$project" --member="serviceAccount:$account" --role=roles/firebaseappdistro.admin --condition=None >/dev/null

if ! gcloud iam workload-identity-pools describe "$pool" --project="$project" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$pool" --project="$project" --location=global --display-name='Rephase GitHub releases'
fi
if gcloud iam workload-identity-pools providers describe "$provider" --project="$project" --location=global --workload-identity-pool="$pool" >/dev/null 2>&1; then
  provider_command=update-oidc
else
  provider_command=create-oidc
fi
gcloud iam workload-identity-pools providers "$provider_command" "$provider" \
  --project="$project" --location=global --workload-identity-pool="$pool" \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id' \
  --attribute-condition="$condition"
gcloud iam service-accounts add-iam-policy-binding "$account" --project="$project" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$project_number/locations/global/workloadIdentityPools/$pool/attribute.repository_id/1419941709" >/dev/null

gh variable set FIREBASE_PROJECT_ID --repo "$repo" --env android-beta --body "$project"
gh variable set FIREBASE_SERVICE_ACCOUNT --repo "$repo" --env android-beta --body "$account"
gh variable set FIREBASE_WORKLOAD_IDENTITY_PROVIDER --repo "$repo" --env android-beta \
  --body "projects/$project_number/locations/global/workloadIdentityPools/$pool/providers/$provider"
gh variable set FIREBASE_TESTER_GROUP --repo "$repo" --env android-beta --body friends-family
echo 'Firebase trust configured for this repository, main branch, beta workflow and GitHub environment only.'
echo 'Next: add FIREBASE_APP_ID, GOOGLE_SERVER_CLIENT_ID and the signing secrets described in mobile/DISTRIBUTION.md.'
