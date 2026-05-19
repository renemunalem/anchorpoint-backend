import { importSalesforceTimeline } from "../src/imports/salesforce/importSalesforceTimeline";

void importSalesforceTimeline()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
