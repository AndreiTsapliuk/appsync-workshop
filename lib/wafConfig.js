const cdk = require('constructs')
const waf2 = require('aws-cdk-lib/aws-wafv2')

/**
 * AWS WAF Construct
 *
 * @class WafConfig
 * @typedef {WafConfig}
 * @extends {cdk.Construct}
 */
class WafConfig extends cdk.Construct {
  constructor(scope, id, { api }) {
    super(scope, id)

    // Configure access policy for IP configs
    const allowedIPSet = new waf2.CfnIPSet(this, 'MyIP', {
      addresses: ['192.168.0.17/32'],
      ipAddressVersion: 'IPV4',
      scope: 'REGIONAL',
      name: 'MyIPSet-AppSyncWorkshop',
    })

    // Configure Access Controll List for WAF service
    const acl = new waf2.CfnWebACL(this, `ACL`, {
      defaultAction: { allow: {} },
      scope: 'REGIONAL',
      name: `WorkshopAPI-ACL`,
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        sampledRequestsEnabled: true,
        metricName: 'WorkshopAPI',
      },
      rules: [
        {
          name: 'FloodProtection',
          action: { block: {} },
          priority: 1,
          statement: {
            rateBasedStatement: { aggregateKeyType: 'IP', limit: 1000 },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            sampledRequestsEnabled: true,
            metricName: `WorkshopAPI-FloodProtection`,
          },
        },
        {
          name: 'RestrictAPIKey',
          action: { block: {} },
          priority: 2,
          statement: {
            andStatement: {
              statements: [
                {
                  byteMatchStatement: {
                    fieldToMatch: { singleHeader: { name: 'x-api-key' } },
                    positionalConstraint: 'EXACTLY',
                    searchString: api.apiKey,
                    textTransformations: [{ priority: 1, type: 'LOWERCASE' }],
                  },
                },
                {
                  notStatement: {
                    statement: {
                      ipSetReferenceStatement: { arn: allowedIPSet.attrArn },
                    },
                  },
                },
              ],
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            sampledRequestsEnabled: true,
            metricName: `WorkshopAPI-RestrictAPIKey`,
          },
        },
      ],
    })

    // Define WAF association between ACL & resources
    const association = new waf2.CfnWebACLAssociation(this, 'APIAssoc', {
      resourceArn: api.arn,
      webAclArn: acl.attrArn,
    })

    this.acl = acl
    this.association = association
  }
}

module.exports = { WafConfig }
