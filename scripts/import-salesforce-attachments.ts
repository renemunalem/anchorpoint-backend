import { importSalesforceAttachments } from "../src/imports/salesforce/importSalesforceAttachments";

void importSalesforceAttachments()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
