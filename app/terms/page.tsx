"use client"

import React from "react"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"

export default function TermsOfService() {
  return (
    <div className="max-w-[800px] mx-auto py-8 px-4 space-y-8">
      <div className="flex items-center gap-4">
        <Link href="/">
          <Button variant="ghost" size="sm" className="flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Terms of Service</h1>
      </div>

      <div className="prose prose-gray max-w-none">
        <p className="text-sm text-gray-500">Effective Date: March 4, 2024</p>

        <p>
          Welcome to Stitchflow. These Terms of Service ("Terms") govern your access to and use of Stitchflow's 
          website, products, and services (collectively, the "Services"). Please read these Terms carefully before 
          using the Services.
        </p>

        <h2>1. Acceptance of Terms</h2>

        <p>
          By accessing or using the Services, you agree to be bound by these Terms. If you are using the Services 
          on behalf of an organization, you are agreeing to these Terms for that organization and promising that 
          you have the authority to bind that organization to these Terms. In that case, "you" and "your" will 
          refer to that organization.
        </p>

        <h2>2. Changes to Terms</h2>

        <p>
          We may modify these Terms at any time. If we make changes, we will provide notice by posting the updated 
          Terms on our website and updating the "Effective Date" at the top of these Terms. Your continued use of 
          the Services after any changes indicates your acceptance of the modified Terms.
        </p>

        <h2>3. Privacy Policy</h2>

        <p>
          Our Privacy Policy describes how we collect, use, and handle your personal information when you use our 
          Services. By using our Services, you agree to our Privacy Policy.
        </p>

        <h2>4. Account Terms</h2>

        <p>
          You must be 18 years or older to use the Services. You must provide accurate and complete information 
          when creating an account. You are responsible for maintaining the security of your account and password. 
          We cannot and will not be liable for any loss or damage from your failure to comply with this security 
          obligation.
        </p>

        <h2>5. Payment Terms</h2>

        <p>
          Some of our Services require payment. You agree to pay all fees in accordance with the pricing and 
          payment terms presented to you for the Service. Fees are non-refundable except as required by law or as 
          explicitly stated in these Terms.
        </p>

        <h2>6. Service Level Agreement</h2>

        <p>
          We strive to provide the Services with an uptime of 99.9%. However, we do not guarantee that the Services 
          will be uninterrupted, timely, secure, or error-free. We are not responsible for any delays, delivery 
          failures, or other damage resulting from such problems.
        </p>

        <h2>7. Intellectual Property</h2>

        <p>
          The Services and all content and materials included on the Services, such as text, graphics, logos, 
          button icons, images, audio clips, information, data, software, and the selection and arrangement 
          thereof (collectively, "Content"), are the property of Stitchflow or its licensors and are protected by 
          U.S. and international copyright, trademark, patent, trade secret, and other intellectual property or 
          proprietary rights laws.
        </p>

        <h2>8. User Content</h2>

        <p>
          You retain all rights to any content you submit, post, or display on or through the Services. By 
          submitting, posting, or displaying content on or through the Services, you grant us a worldwide, 
          non-exclusive, royalty-free license to use, reproduce, modify, adapt, publish, translate, and distribute 
          such content in connection with providing the Services.
        </p>

        <h2>9. Acceptable Use</h2>

        <p>
          You agree not to misuse our Services or help anyone else do so. You must not:
        </p>

        <ul>
          <li>Use the Services for any illegal purpose</li>
          <li>Violate any laws in your jurisdiction</li>
          <li>Share or promote illegal content</li>
          <li>Infringe on others' intellectual property rights</li>
          <li>Use the Services to harass, abuse, or harm others</li>
          <li>Interfere with or disrupt the Services</li>
          <li>Attempt to access accounts or data that don't belong to you</li>
          <li>Use the Services to distribute malware or harmful code</li>
        </ul>

        <h2>10. Termination</h2>

        <p>
          We may terminate or suspend your access to the Services immediately, without prior notice or liability, 
          for any reason whatsoever, including without limitation if you breach the Terms. Upon termination, your 
          right to use the Services will immediately cease.
        </p>

        <h2>11. Limitation of Liability</h2>

        <p>
          To the maximum extent permitted by law, in no event shall Stitchflow, its directors, employees, partners, 
          agents, suppliers, or affiliates be liable for any indirect, incidental, special, consequential or 
          punitive damages, including without limitation, loss of profits, data, use, goodwill, or other 
          intangible losses, resulting from your access to or use of or inability to access or use the Services.
        </p>

        <h2>12. Disclaimer</h2>

        <p>
          The Services are provided "as is" and "as available" without warranties of any kind, either express or 
          implied, including, but not limited to, implied warranties of merchantability, fitness for a particular 
          purpose, title, and non-infringement.
        </p>

        <h2>13. Governing Law</h2>

        <p>
          These Terms shall be governed by and construed in accordance with the laws of the State of California, 
          United States, without regard to its conflict of law provisions.
        </p>

        <h2>14. Dispute Resolution</h2>

        <p>
          Any dispute arising from or relating to these Terms or the Services shall be resolved through binding 
          arbitration in accordance with the American Arbitration Association's rules. The arbitration shall be 
          conducted in English in San Francisco, California.
        </p>

        <h2>15. Severability</h2>

        <p>
          If any provision of these Terms is found to be unenforceable or invalid, that provision shall be limited 
          or eliminated to the minimum extent necessary so that the Terms shall otherwise remain in full force and 
          effect and enforceable.
        </p>

        <h2>16. Contact Us</h2>

        <p>
          If you have any questions about these Terms, please contact us at legal@stitchflow.io.
        </p>
      </div>
    </div>
  )
} 