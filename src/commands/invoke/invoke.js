const { CloudFormationClient, DescribeStackResourcesCommand } = require("@aws-sdk/client-cloudformation");
const { fromSSO } = require("@aws-sdk/credential-provider-sso");
const lambdaInvoker = require("./lambdaInvoker");
const stepFunctionsInvoker = require("./stepFunctionsInvoker");
const inputUtil = require('../../shared/inputUtil');
const parser = require("../../shared/parser");
const fs = require("fs");
const ini = require('ini');
const link2aws = require('link2aws');
const open = import('open');
let region;
async function run(cmd) {
  if (fs.existsSync("samconfig.toml")) {
    const config = ini.parse(fs.readFileSync("samconfig.toml", "utf8"));
    const params = config?.default?.deploy?.parameters || config?.default?.global?.parameters || {};
    if (!cmd.stackName && params.stack_name) {
      console.log("Using stack name from config:", params.stack_name);
      cmd.stackName = params.stack_name;
    }
    if (!cmd.profile && params.profile) {
      console.log("Using AWS profile from config:", params.profile);
      cmd.profile = params.profile;
    }
    if (!cmd.region && params.region) {
      console.log("Using AWS region from config:", params.region);
      cmd.region = params.region;
      region = params.region;
    }
  }
  const credentials = await fromSSO({ profile: cmd.profile })();
  if (!cmd.stackName) {
    console.error("Missing required option: --stack-name");
    process.exit(1);
  }

  const cloudFormation = new CloudFormationClient({ credentials: credentials, region: cmd.region });
  let resources;
  try {
    resources = await cloudFormation.send(new DescribeStackResourcesCommand({ StackName: cmd.stackName }));
  }
  catch (e) {
    console.log(`Failed to describe stack resources: ${e.message}`);
    process.exit(1);
  }
  const targets = resources.StackResources.filter(r => ["AWS::Lambda::Function", "AWS::StepFunctions::StateMachine"].includes(r.ResourceType)).map(r => { return { name: `${r.LogicalResourceId} [${r.ResourceType.split("::")[1]}]`, value: r } });

  if (targets.length === 0) {
    console.log("No compatible resources found in stack");
    return;
  }
  let resource;

  if (targets.length === 1) {
    resource = targets[0].value;
  }
  else {
    resource = await inputUtil.autocomplete("Select a resource", targets);
  }
  if (resource.ResourceType === "AWS::StepFunctions::StateMachine") {
    await stepFunctionsInvoker.invoke(cmd, resource.PhysicalResourceId);
  }
  else {
    await lambdaInvoker.invoke(cmd, resource.PhysicalResourceId);
  }
}

async function getPhysicalId(cloudFormation, stackName, logicalId) {
  const params = {
    StackName: stackName,
    LogicalResourceId: logicalId
  };
  if (logicalId.endsWith(" Logs")) {
    const logGroupParentResource = logicalId.split(" ")[0];
    params.LogicalResourceId = logGroupParentResource;
  }

  const response = await cloudFormation.send(new DescribeStackResourcesCommand(params));
  if (response.StackResources.length === 0) {
    console.log(`No stack resource found for ${logicalId}`);
    process.exit(1);
  }
  if (logicalId.endsWith(" Logs")) {
    const logGroup = `/aws/lambda/${response.StackResources[0].PhysicalResourceId}`;
    const source = `$257E$2527${logGroup}`.replace(/\//g, "*2f")
    const query = `fields*20*40timestamp*2c*20*40message*2c*20*40logStream*2c*20*40log*0a*7c*20filter*20*40message*20like*20*2f*2f*0a*7c*20sort*20*40timestamp*20desc*0a*7c*20limit*2020`;
    return `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:logs-insights$3FqueryDetail$3D$257E$2528end$257E0$257Estart$257E-3600$257EtimeType$257E$2527RELATIVE$257Eunit$257E$2527seconds$257EeditorString$257E$2527${query}$257EisLiveTail$257Efalse$257Esource$257E$2528${source}$2529$2529`
  }

  return response.StackResources[0].PhysicalResourceId;
}

function createARN(resourceType, resourceName) {
  if (!resourceType.includes("::")) {
    console.log(`Can't create ARN for ${resourceType}`);
    return;
  }
  if (resourceName.startsWith("arn:")) {
    return resourceName;
  }
  let service = resourceType.split("::")[1].toLowerCase();
  const noResourceTypeArns = [
    "s3",
    "sqs",
    "sns",
  ]
  const type = noResourceTypeArns.includes(service) ? "" : resourceType.split("::")[2].toLowerCase();

  if (service === "sqs") {
    resourceName = resourceName.split("/").pop();
  }

  //map sam to cloudformation
  if (service === "serverless") {
    switch (type) {
      case "function":
        service = "lambda";
        break;
      case "api":
        service = "apigateway";
        break;
      case "table":
        service = "dynamodb";
        break;
      case "statemachine":
        service = "states";
        break;
    }
  }

  return `arn:aws:${service}:${region}::${type}:${resourceName}`;
}

module.exports = {
  run
};

